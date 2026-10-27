import { randomUUID } from 'node:crypto';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import {
  assistantAttemptsCol,
  assistantSpendCol,
  assistantUsageCol,
} from '../../db/collections.js';
import type { AssistantAttemptDoc } from '../../db/types.js';
import { AppError } from '../../errors.js';
import { microUsdFor, type ModelPrice } from './prices.js';

/** Model calls in flight per user, across every conversation and key. */
export const MAX_IN_FLIGHT = 2;
/**
 * Every call that ends frees its slot (trackAttempts). A slot held longer than this belongs to
 * a call whose process died before it could; the next reservation frees it.
 */
export const ATTEMPT_LEASE_MS = 120_000;
export const ATTEMPT_RETENTION_DAYS = 7;

export class BudgetError extends AppError {
  resetsAt: string | null;
  constructor(
    code: 'ASSISTANT_BUSY' | 'ASSISTANT_DAILY_CAP' | 'ASSISTANT_MONTHLY_CAP',
    resetsAt: Date | null,
  ) {
    super(
      429,
      code,
      code === 'ASSISTANT_BUSY' ? 'Too many model calls in flight' : 'Assistant budget reached',
    );
    this.name = 'BudgetError';
    this.resetsAt = resetsAt ? resetsAt.toISOString() : null;
  }
}

const GRPC_INVALID_ARGUMENT = 3;
const GRPC_ABORTED = 10;

/**
 * A reservation whose transaction lost to contention (gRPC ABORTED, or INVALID_ARGUMENT for a
 * transaction the emulator or server closed while it retried) is a busy ledger, not a server
 * fault: the caller is told to try again, and nothing was reserved.
 */
export function reservationFailure(error: unknown): unknown {
  if (error instanceof AppError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  if (code === GRPC_INVALID_ARGUMENT || code === GRPC_ABORTED)
    return new BudgetError('ASSISTANT_BUSY', null);
  return error;
}

export interface ReserveInput {
  userId: string;
  now: Date;
  estimate: { inputTokens: number; outputTokens: number };
  price: ModelPrice;
  caps: { dailyTokens: number; monthlyMicroUsd: number };
}
export interface Reservation {
  attemptId: string;
  day: string;
  month: string;
  reservedTokens: number;
  reservedMicroUsd: number;
}

export const dayKey = (date: Date): string => date.toISOString().slice(0, 10);
export const monthKey = (date: Date): string => date.toISOString().slice(0, 7);
export const nextDayStart = (day: string): Date => new Date(`${addDays(day, 1)}T00:00:00.000Z`);
export const nextMonthStart = (month: string): Date => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1));
};
function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return dayKey(d);
}

/**
 * Reserve, then settle (RFC-0003-wally-agent.md §3.2). One transaction reads the user's day, the
 * deployment's month and the user's in-flight slots, refuses if any cap or the slot count
 * would be exceeded, and otherwise writes the worst case into all three. Nothing is
 * dispatched before this commits.
 *
 * The in-flight bound is per user, not per day: slots live on the day document they were
 * reserved on, so within one lease of midnight the transaction also reads the previous
 * day's document and counts its live slots. A slot from any earlier day has outlived its
 * lease, since the lease is far shorter than a day.
 */
export async function reserveAttempt(db: Firestore, input: ReserveInput): Promise<Reservation> {
  const { userId, now, estimate, price, caps } = input;
  const day = dayKey(now);
  const month = monthKey(now);
  const reservedTokens = estimate.inputTokens + estimate.outputTokens;
  const reservedMicroUsd = microUsdFor(price, estimate);
  const attemptId = randomUUID();
  const usageRef = assistantUsageCol(db, userId).doc(day);
  const spendRef = assistantSpendCol(db).doc(month);
  const attemptRef = assistantAttemptsCol(db, userId).doc(attemptId);

  // A slot reserved yesterday can still be live only while less than one lease has passed
  // since today began.
  const previousDayRef =
    now.getTime() - Date.parse(`${day}T00:00:00.000Z`) < ATTEMPT_LEASE_MS
      ? assistantUsageCol(db, userId).doc(addDays(day, -1))
      : null;
  const isLive = (startedAt: number) => now.getTime() - startedAt < ATTEMPT_LEASE_MS;

  const transaction = db.runTransaction(async (tx) => {
    const [usageSnap, spendSnap, previousDaySnap] = await Promise.all([
      tx.get(usageRef),
      tx.get(spendRef),
      previousDayRef ? tx.get(previousDayRef) : null,
    ]);
    const usage = usageSnap.data() ?? { tokens: 0, inFlight: {}, updatedAt: Timestamp.now() };
    const spend = spendSnap.data() ?? { microUsd: 0, updatedAt: Timestamp.now() };
    // Slots whose lease expired belong to calls that died; their charge stays, the slot goes.
    const inFlight = Object.fromEntries(
      Object.entries(usage.inFlight).filter(([, startedAt]) => isLive(startedAt)),
    );
    // Yesterday's live slots count but stay where they are; their settlement frees them.
    const liveYesterday = Object.values(previousDaySnap?.data()?.inFlight ?? {}).filter(
      isLive,
    ).length;
    if (Object.keys(inFlight).length + liveYesterday >= MAX_IN_FLIGHT)
      throw new BudgetError('ASSISTANT_BUSY', null);
    if (usage.tokens + reservedTokens > caps.dailyTokens)
      throw new BudgetError('ASSISTANT_DAILY_CAP', nextDayStart(day));
    if (spend.microUsd + reservedMicroUsd > caps.monthlyMicroUsd)
      throw new BudgetError('ASSISTANT_MONTHLY_CAP', nextMonthStart(month));

    const stamp = Timestamp.fromDate(now);
    tx.set(usageRef, {
      tokens: usage.tokens + reservedTokens,
      inFlight: { ...inFlight, [attemptId]: now.getTime() },
      updatedAt: stamp,
    });
    tx.set(spendRef, { microUsd: spend.microUsd + reservedMicroUsd, updatedAt: stamp });
    const attempt: AssistantAttemptDoc = {
      day,
      month,
      reservedTokens,
      reservedMicroUsd,
      inputMicroUsdPerToken: price.inputMicroUsdPerToken,
      outputMicroUsdPerToken: price.outputMicroUsdPerToken,
      state: 'RESERVED',
      createdAt: stamp,
      expiresAt: Timestamp.fromMillis(now.getTime() + ATTEMPT_RETENTION_DAYS * 86_400_000),
    };
    tx.create(attemptRef, attempt);
  });
  // A transaction lost to contention is a busy refusal, like a full in-flight count.
  await transaction.catch((error: unknown) => {
    throw reservationFailure(error);
  });
  return { attemptId, day, month, reservedTokens, reservedMicroUsd };
}

/**
 * Replaces the reservation with actual usage, exactly once, in the day and month the
 * attempt was reserved on. A second call is a no-op; a late call never touches today. A
 * released attempt still settles: usage that arrives after all replaces its worst case.
 *
 * Usage that is not a finite, non-negative count is refused before anything is read: the
 * reservation stays as it is (RFC-0003-wally-agent.md §3.2, missing usage keeps the charge), and NaN
 * can never reach the counters.
 */
export async function settleAttempt(
  db: Firestore,
  userId: string,
  attemptId: string,
  actual: { inputTokens: number; outputTokens: number },
  now: Date,
): Promise<void> {
  const isCount = (n: number) => Number.isFinite(n) && n >= 0;
  if (!isCount(actual.inputTokens) || !isCount(actual.outputTokens))
    throw new Error('Unknown usage: the reservation is kept');
  const attemptRef = assistantAttemptsCol(db, userId).doc(attemptId);
  await db.runTransaction(async (tx) => {
    const attempt = (await tx.get(attemptRef)).data();
    if (!attempt || attempt.state === 'SETTLED') return;
    const usageRef = assistantUsageCol(db, userId).doc(attempt.day);
    const spendRef = assistantSpendCol(db).doc(attempt.month);
    const [usageSnap, spendSnap] = await Promise.all([tx.get(usageRef), tx.get(spendRef)]);
    const settledTokens = actual.inputTokens + actual.outputTokens;
    // Priced with the price the attempt was reserved at.
    const settledMicroUsd = microUsdFor(
      {
        inputMicroUsdPerToken: attempt.inputMicroUsdPerToken,
        outputMicroUsdPerToken: attempt.outputMicroUsdPerToken,
      },
      actual,
    );
    const stamp = Timestamp.fromDate(now);
    const usage = usageSnap.data();
    if (usage) {
      const inFlight = Object.fromEntries(
        Object.entries(usage.inFlight).filter(([id]) => id !== attemptId),
      );
      tx.set(usageRef, {
        tokens: Math.max(0, usage.tokens - attempt.reservedTokens + settledTokens),
        inFlight,
        updatedAt: stamp,
      });
    }
    const spend = spendSnap.data();
    if (spend && attempt.reservedMicroUsd > 0)
      tx.set(spendRef, {
        microUsd: Math.max(0, spend.microUsd - attempt.reservedMicroUsd + settledMicroUsd),
        updatedAt: stamp,
      });
    tx.update(attemptRef, { state: 'SETTLED', settledTokens, settledMicroUsd, settledAt: stamp });
  });
}

/**
 * Ends an attempt whose usage will not be known (the call failed, ran past its deadline or
 * reported none): its slot is free at once, its worst case stays charged (RFC-0003-wally-agent.md
 * §3.2, missing usage keeps the charge). Only a reserved attempt is released; a settled or
 * already released one is left as it is.
 */
export async function releaseAttempt(
  db: Firestore,
  userId: string,
  attemptId: string,
  now: Date,
): Promise<void> {
  const attemptRef = assistantAttemptsCol(db, userId).doc(attemptId);
  await db.runTransaction(async (tx) => {
    const attempt = (await tx.get(attemptRef)).data();
    if (attempt?.state !== 'RESERVED') return;
    const usageRef = assistantUsageCol(db, userId).doc(attempt.day);
    const usage = (await tx.get(usageRef)).data();
    const stamp = Timestamp.fromDate(now);
    if (usage) {
      const inFlight = Object.fromEntries(
        Object.entries(usage.inFlight).filter(([id]) => id !== attemptId),
      );
      tx.set(usageRef, { tokens: usage.tokens, inFlight, updatedAt: stamp });
    }
    tx.update(attemptRef, { state: 'ABANDONED', abandonedAt: stamp });
  });
}

export interface TrackedAttempts {
  reserve: (input: Omit<ReserveInput, 'userId' | 'now'>) => Promise<Reservation>;
  settle: (
    attemptId: string,
    actual: { inputTokens: number; outputTokens: number },
  ) => Promise<void>;
  /** Frees one attempt's slot without usage, keeping its charge. Never throws. */
  release: (attemptId: string) => Promise<void>;
  /** Frees the slot of every attempt not yet settled or released. Never throws. */
  releaseRest: () => Promise<void>;
}

/**
 * The attempts one operation (a question, a capture, a tidy) reserves for one user. Each ends
 * settled with its usage or released without it, and `releaseRest` ends the ones still open
 * when the operation is done, so a call that failed, timed out or reported nothing never
 * holds a slot the person's next call needs.
 *
 * A release that fails is reported to `onReleaseError` instead of thrown: it runs while an
 * operation unwinds, where a second error would hide the first. Its slot then stays until
 * the lease expires.
 */
export function trackAttempts(
  db: Firestore,
  userId: string,
  options: { clock: () => Date; onReleaseError?: (error: unknown) => void },
): TrackedAttempts {
  const { clock, onReleaseError } = options;
  const open = new Set<string>();
  const release = async (attemptId: string) => {
    if (!open.delete(attemptId)) return;
    await releaseAttempt(db, userId, attemptId, clock()).catch((error: unknown) =>
      onReleaseError?.(error),
    );
  };
  return {
    reserve: async (input) => {
      const reservation = await reserveAttempt(db, { ...input, userId, now: clock() });
      open.add(reservation.attemptId);
      return reservation;
    },
    // A settlement that fails leaves the attempt open, for `releaseRest` to free.
    settle: async (attemptId, actual) => {
      await settleAttempt(db, userId, attemptId, actual, clock());
      open.delete(attemptId);
    },
    release,
    releaseRest: async () => {
      await Promise.all([...open].map(release));
    },
  };
}
