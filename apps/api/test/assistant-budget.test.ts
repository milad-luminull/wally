import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  BudgetError,
  dayKey,
  MAX_IN_FLIGHT,
  monthKey,
  nextDayStart,
  releaseAttempt,
  reservationFailure,
  reserveAttempt,
  settleAttempt,
  trackAttempts,
} from '../src/lib/assistant/budget/ledger.js';
import { AppError } from '../src/lib/errors.js';
import {
  assistantAttemptsCol,
  assistantSpendCol,
  assistantUsageCol,
} from '../src/lib/db/collections.js';
import { buildTestApp, resetDatabase, type TestContext } from './helpers.js';

const PROJECT_ID = 'wally-test-assistant-budget';
const price = { inputMicroUsdPerToken: 1.5, outputMicroUsdPerToken: 7.5 };
const caps = { dailyTokens: 10_000, monthlyMicroUsd: 1_000_000 };
const now = new Date('2026-10-15T10:00:00.000Z');
const estimate = { inputTokens: 2_000, outputTokens: 1_000 }; // 3000 tokens, 10500 micro-USD

describe('assistant budget ledger', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await buildTestApp(PROJECT_ID);
  });
  afterEach(async () => {
    await resetDatabase(PROJECT_ID);
  });
  afterAll(async () => {
    await resetDatabase(PROJECT_ID);
    await ctx.app.close();
  });
  const reserve = (userId = 'u1', overrides: Partial<Parameters<typeof reserveAttempt>[1]> = {}) =>
    reserveAttempt(ctx.db, { userId, now, estimate, price, caps, ...overrides });

  it('reserves tokens and money, then settles with actual usage exactly once', async () => {
    const r = await reserve();
    expect(r).toMatchObject({
      day: '2026-10-15',
      month: '2026-10',
      reservedTokens: 3000,
      reservedMicroUsd: 10500,
    });
    expect((await assistantUsageCol(ctx.db, 'u1').doc(r.day).get()).data()).toMatchObject({
      tokens: 3000,
    });
    expect((await assistantSpendCol(ctx.db).doc(r.month).get()).data()).toMatchObject({
      microUsd: 10500,
    });

    await settleAttempt(ctx.db, 'u1', r.attemptId, { inputTokens: 1_200, outputTokens: 100 }, now);
    expect((await assistantUsageCol(ctx.db, 'u1').doc(r.day).get()).data()).toMatchObject({
      tokens: 1300,
      inFlight: {},
    });
    expect((await assistantSpendCol(ctx.db).doc(r.month).get()).data()).toMatchObject({
      microUsd: 2550,
    });
    const attempt = (await assistantAttemptsCol(ctx.db, 'u1').doc(r.attemptId).get()).data();
    expect(attempt).toMatchObject({ state: 'SETTLED', settledTokens: 1300, settledMicroUsd: 2550 });

    await settleAttempt(
      ctx.db,
      'u1',
      r.attemptId,
      { inputTokens: 9_999, outputTokens: 9_999 },
      now,
    );
    expect((await assistantUsageCol(ctx.db, 'u1').doc(r.day).get()).data()).toMatchObject({
      tokens: 1300,
    });
    expect((await assistantSpendCol(ctx.db).doc(r.month).get()).data()).toMatchObject({
      microUsd: 2550,
    });
  });

  it('refuses the daily token cap with the reset time and leaves nothing reserved', async () => {
    const first = await reserve('u1', { estimate: { inputTokens: 7_000, outputTokens: 1_000 } });
    await settleAttempt(
      ctx.db,
      'u1',
      first.attemptId,
      { inputTokens: 7_000, outputTokens: 1_000 },
      now,
    );
    await expect(reserve()).rejects.toMatchObject({
      statusCode: 429,
      code: 'ASSISTANT_DAILY_CAP',
      resetsAt: nextDayStart('2026-10-15').toISOString(),
    } satisfies Partial<BudgetError>);
    expect((await assistantUsageCol(ctx.db, 'u1').doc('2026-10-15').get()).data()).toMatchObject({
      tokens: 8000,
      inFlight: {},
    });
    expect((await assistantAttemptsCol(ctx.db, 'u1').get()).size).toBe(1);
  });

  it('refuses the monthly money cap across users', async () => {
    const tight = { dailyTokens: 1_000_000, monthlyMicroUsd: 20_000 };
    await reserve('u1', { caps: tight });
    await expect(reserve('u2', { caps: tight })).rejects.toMatchObject({
      code: 'ASSISTANT_MONTHLY_CAP',
    });
    expect((await assistantSpendCol(ctx.db).doc('2026-10').get()).data()).toMatchObject({
      microUsd: 10500,
    });
  });

  it('allows at most two attempts in flight per user and frees a slot on settlement or lease expiry', async () => {
    const a = await reserve();
    const b = await reserve();
    expect(MAX_IN_FLIGHT).toBe(2);
    await expect(reserve()).rejects.toMatchObject({ code: 'ASSISTANT_BUSY', resetsAt: null });
    await settleAttempt(ctx.db, 'u1', a.attemptId, { inputTokens: 10, outputTokens: 10 }, now);
    const c = await reserve();
    expect(c.attemptId).not.toBe(b.attemptId);
    // b and c are stuck; after the lease expires a new reservation prunes them.
    const later = new Date(now.getTime() + 121_000);
    const d = await reserve('u1', { now: later });
    const usage = (await assistantUsageCol(ctx.db, 'u1').doc(dayKey(later)).get()).data();
    expect(Object.keys(usage!.inFlight)).toEqual([d.attemptId]);
    // Stuck attempts keep their worst-case charge.
    expect(usage!.tokens).toBe(4 * 3000 - (3000 - 20));
  });

  it('counts live slots from the previous day against the in-flight bound across midnight', async () => {
    const lateEvening = new Date('2026-10-15T23:59:30.000Z');
    const a = await reserve('u1', { now: lateEvening });
    await reserve('u1', { now: lateEvening });
    const justAfterMidnight = new Date('2026-10-16T00:00:05.000Z');
    await expect(reserve('u1', { now: justAfterMidnight })).rejects.toMatchObject({
      code: 'ASSISTANT_BUSY',
      resetsAt: null,
    });
    // The refusal wrote nothing to the new day.
    expect((await assistantUsageCol(ctx.db, 'u1').doc('2026-10-16').get()).exists).toBe(false);
    // Settling one of yesterday's calls frees its slot for today.
    await settleAttempt(
      ctx.db,
      'u1',
      a.attemptId,
      { inputTokens: 10, outputTokens: 10 },
      justAfterMidnight,
    );
    const today = await reserve('u1', { now: justAfterMidnight });
    expect(today.day).toBe('2026-10-16');
    await expect(reserve('u1', { now: justAfterMidnight })).rejects.toMatchObject({
      code: 'ASSISTANT_BUSY',
    });
    // Once yesterday's remaining lease (23:59:30 + 120 s) has run out, only today's slot counts.
    const afterLease = new Date('2026-10-16T00:01:31.000Z');
    const next = await reserve('u1', { now: afterLease });
    const usage = (await assistantUsageCol(ctx.db, 'u1').doc('2026-10-16').get()).data();
    expect(Object.keys(usage!.inFlight).sort()).toEqual([today.attemptId, next.attemptId].sort());
  });

  it('a late settlement adjusts the day it was reserved on, not the current day', async () => {
    const r = await reserve();
    const nextDay = new Date('2026-10-16T01:00:00.000Z');
    await settleAttempt(ctx.db, 'u1', r.attemptId, { inputTokens: 100, outputTokens: 50 }, nextDay);
    expect((await assistantUsageCol(ctx.db, 'u1').doc('2026-10-15').get()).data()).toMatchObject({
      tokens: 150,
    });
    expect((await assistantUsageCol(ctx.db, 'u1').doc('2026-10-16').get()).exists).toBe(false);
    expect(monthKey(nextDay)).toBe('2026-10');
  });

  it('never overshoots a cap under concurrent reservations', async () => {
    // 350: the in-flight bound binds first; 150: the token cap does.
    for (const [userId, dailyTokens] of [
      ['solo', 350],
      ['tight', 150],
    ] as const) {
      const single = await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          reserveAttempt(ctx.db, {
            userId,
            now,
            estimate: { inputTokens: 100, outputTokens: 0 },
            price,
            caps: { dailyTokens, monthlyMicroUsd: 1_000_000 },
          }),
        ),
      );
      // How many win depends on timing (contention can refuse some before any bound does);
      // the invariants do not.
      const won = single.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
      expect(won.length, userId).toBeGreaterThanOrEqual(1);
      expect(won.length, userId).toBeLessThanOrEqual(
        Math.min(Math.floor(dailyTokens / 100), MAX_IN_FLIGHT),
      );
      for (const s of single)
        if (s.status === 'rejected') expect(s.reason, userId).toBeInstanceOf(BudgetError);
      for (const r of won)
        await settleAttempt(
          ctx.db,
          userId,
          r.attemptId,
          { inputTokens: 100, outputTokens: 0 },
          now,
        );
      const day = (await assistantUsageCol(ctx.db, userId).doc('2026-10-15').get()).data()!;
      expect(day.tokens, userId).toBeLessThanOrEqual(dailyTokens);
      expect(day.tokens, userId).toBe(won.length * 100);
      expect(day.inFlight, userId).toEqual({});
    }
  });

  it('refuses usage that is not a count and keeps the reservation', async () => {
    const r = await reserve();
    for (const bad of [
      { inputTokens: Number.NaN, outputTokens: 10 },
      { inputTokens: 10, outputTokens: Number.POSITIVE_INFINITY },
      { inputTokens: -1, outputTokens: 10 },
    ])
      await expect(settleAttempt(ctx.db, 'u1', r.attemptId, bad, now)).rejects.toThrow(
        'Unknown usage',
      );
    const usage = (await assistantUsageCol(ctx.db, 'u1').doc(r.day).get()).data();
    expect(usage).toMatchObject({ tokens: 3000 });
    expect(Object.keys(usage!.inFlight)).toEqual([r.attemptId]);
    expect((await assistantSpendCol(ctx.db).doc(r.month).get()).data()).toMatchObject({
      microUsd: 10500,
    });
    expect((await assistantAttemptsCol(ctx.db, 'u1').doc(r.attemptId).get()).data()).toMatchObject({
      state: 'RESERVED',
    });
  });

  it('frees the slot of an attempt released without usage at once, and keeps its worst-case charge', async () => {
    const a = await reserve();
    await reserve();
    await expect(reserve()).rejects.toMatchObject({ code: 'ASSISTANT_BUSY' });

    await releaseAttempt(ctx.db, 'u1', a.attemptId, now);
    const usage = (await assistantUsageCol(ctx.db, 'u1').doc(a.day).get()).data();
    expect(Object.keys(usage!.inFlight)).not.toContain(a.attemptId);
    expect(usage!.tokens).toBe(2 * 3000);
    expect((await assistantSpendCol(ctx.db).doc(a.month).get()).data()).toMatchObject({
      microUsd: 2 * 10500,
    });
    expect((await assistantAttemptsCol(ctx.db, 'u1').doc(a.attemptId).get()).data()).toMatchObject({
      state: 'ABANDONED',
    });
    // Well within the lease: the freed slot is usable right away.
    await expect(reserve()).resolves.toMatchObject({ reservedTokens: 3000 });
  });

  it('leaves a settled attempt alone on release, and lets late usage replace a released charge', async () => {
    const settled = await reserve();
    await settleAttempt(
      ctx.db,
      'u1',
      settled.attemptId,
      { inputTokens: 10, outputTokens: 10 },
      now,
    );
    await releaseAttempt(ctx.db, 'u1', settled.attemptId, now);
    expect(
      (await assistantAttemptsCol(ctx.db, 'u1').doc(settled.attemptId).get()).data(),
    ).toMatchObject({ state: 'SETTLED', settledTokens: 20 });

    const released = await reserve();
    await releaseAttempt(ctx.db, 'u1', released.attemptId, now);
    await releaseAttempt(ctx.db, 'u1', released.attemptId, now);
    await settleAttempt(
      ctx.db,
      'u1',
      released.attemptId,
      { inputTokens: 100, outputTokens: 50 },
      now,
    );
    expect((await assistantUsageCol(ctx.db, 'u1').doc(released.day).get()).data()).toMatchObject({
      tokens: 20 + 150,
      inFlight: {},
    });
    expect(
      (await assistantAttemptsCol(ctx.db, 'u1').doc(released.attemptId).get()).data(),
    ).toMatchObject({ state: 'SETTLED', settledTokens: 150 });
  });

  it('frees every slot an operation still holds when it ends, and none it settled or another holds', async () => {
    const other = await reserve();
    const attempts = trackAttempts(ctx.db, 'u1', { clock: () => now });
    const kept = await attempts.reserve({ estimate, price, caps });
    await attempts.settle(kept.attemptId, { inputTokens: 10, outputTokens: 10 });
    const failed = await attempts.reserve({ estimate, price, caps });

    await attempts.releaseRest();
    const usage = (await assistantUsageCol(ctx.db, 'u1').doc(failed.day).get()).data();
    expect(Object.keys(usage!.inFlight)).toEqual([other.attemptId]);
    expect(usage!.tokens).toBe(3000 + 20 + 3000);
    const states = Object.fromEntries(
      (await assistantAttemptsCol(ctx.db, 'u1').get()).docs.map((d) => [d.id, d.data().state]),
    );
    expect(states).toEqual({
      [other.attemptId]: 'RESERVED',
      [kept.attemptId]: 'SETTLED',
      [failed.attemptId]: 'ABANDONED',
    });
  });

  it('frees the slot of an operation whose settlement was refused', async () => {
    const attempts = trackAttempts(ctx.db, 'u1', { clock: () => now });
    const r = await attempts.reserve({ estimate, price, caps });
    await expect(
      attempts.settle(r.attemptId, { inputTokens: Number.NaN, outputTokens: 1 }),
    ).rejects.toThrow('Unknown usage');
    await attempts.releaseRest();
    expect((await assistantUsageCol(ctx.db, 'u1').doc(r.day).get()).data()).toMatchObject({
      tokens: 3000,
      inFlight: {},
    });
  });

  it('reports a release that failed instead of throwing it, and the slot stays until its lease expires', async () => {
    // The datastore refuses transactions once the reservation is in.
    let failing = false;
    const db = new Proxy(ctx.db, {
      get: (target, key) => {
        if (key === 'runTransaction' && failing)
          return () => Promise.reject(new Error('unavailable'));
        const value: unknown = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const errors: unknown[] = [];
    const attempts = trackAttempts(db, 'u1', {
      clock: () => now,
      onReleaseError: (error) => errors.push(error),
    });
    const r = await attempts.reserve({ estimate, price, caps });
    failing = true;
    await expect(attempts.releaseRest()).resolves.toBeUndefined();
    expect(errors).toEqual([expect.objectContaining({ message: 'unavailable' })]);
    expect(
      Object.keys((await assistantUsageCol(ctx.db, 'u1').doc(r.day).get()).data()!.inFlight),
    ).toEqual([r.attemptId]);
  });
});

describe('reservationFailure', () => {
  it('turns transaction contention into a busy refusal and leaves everything else alone', () => {
    for (const code of [3, 10]) {
      const mapped = reservationFailure(Object.assign(new Error('contention'), { code }));
      expect(mapped).toBeInstanceOf(BudgetError);
      expect(mapped).toMatchObject({ code: 'ASSISTANT_BUSY', resetsAt: null });
    }
    const cap = new BudgetError('ASSISTANT_DAILY_CAP', null);
    expect(reservationFailure(cap)).toBe(cap);
    const app = new AppError(404, 'NOT_FOUND', 'Not found');
    expect(reservationFailure(app)).toBe(app);
    const other = Object.assign(new Error('unavailable'), { code: 14 });
    expect(reservationFailure(other)).toBe(other);
  });
});
