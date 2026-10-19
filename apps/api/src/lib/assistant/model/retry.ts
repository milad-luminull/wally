import { AppError } from '../../errors.js';

/**
 * A provider failure that a moment's wait can fix: busy (429), a timeout on its side (408), a
 * fault (5xx), a dropped connection, or anything the library marks `isRetryable`. Never one of
 * our own refusals (budget, deadline) and never an abort, which is ours too.
 */
export function isTemporaryProviderError(error: unknown): boolean {
  if (error instanceof AppError) return false;
  const e = error as { name?: unknown; statusCode?: unknown; isRetryable?: unknown } | null;
  if (!e) return false;
  if (e.name === 'AbortError' || e.name === 'TimeoutError') return false;
  if (e.isRetryable === true) return true;
  if (typeof e.statusCode === 'number')
    return e.statusCode === 408 || e.statusCode === 429 || e.statusCode >= 500;
  return error instanceof TypeError;
}

/** Waits `ms`, or less when the call is aborted meanwhile. */
const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true });
  });

/**
 * Runs `attempt`, and once more after a short pause when it failed temporarily and the
 * deadline still leaves room for a whole attempt (the error handling spec, 2026-10-19; Google
 * advises a retry with backoff for a 429 on the shared pool). Each attempt announces itself
 * to the budget ledger on its own, so the reservation stays exact.
 */
export async function withOneRetry<T>(
  attempt: () => Promise<T>,
  options: {
    signal: AbortSignal;
    /** When the caller's deadline aborts the call, as a `Date.now()` time. */
    deadlineAt: number;
    /** How long one attempt needs at least; less than that left means no retry. */
    minAttemptMs: number;
    delayMs: () => number;
    now?: () => number;
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  },
): Promise<T> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? pause;
  try {
    return await attempt();
  } catch (error) {
    if (!isTemporaryProviderError(error) || options.signal.aborted) throw error;
    const wait = options.delayMs();
    if (now() + wait + options.minAttemptMs > options.deadlineAt) throw error;
    await sleep(wait, options.signal);
    if (options.signal.aborted) throw error;
    return attempt();
  }
}

/** The pause before the one retry: one to two seconds, so retries do not arrive together. */
export const retryDelayMs = () => 1_000 + Math.floor(Math.random() * 1_000);
