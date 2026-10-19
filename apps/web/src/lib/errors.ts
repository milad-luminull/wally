import { ApiError, RequestTimeoutError } from './apiClient';

/**
 * The five kinds of failure (the error handling spec, 2026-10-19). Every surface decides what
 * to show from the kind alone, so the same failure looks the same everywhere.
 */
export type FailureKind = 'temporary' | 'refused' | 'conflict' | 'session' | 'limit';

export interface Failure {
  kind: FailureKind;
  code?: string;
  /** When a limit lifts. */
  resetsAt?: string;
}

const CONFLICT_CODES = new Set(['STALE_REVISION', 'MUTATION_BLOCKED']);
const LIMIT_CODES = new Set(['ASSISTANT_DAILY_CAP', 'ASSISTANT_MONTHLY_CAP']);

/**
 * What kind of failure an error is, or null for a request the app cancelled itself (the
 * account changed): that is no failure to show.
 */
export function failureOf(error: unknown): Failure | null {
  if (error instanceof DOMException && error.name === 'AbortError') return null;
  if (error instanceof RequestTimeoutError) return { kind: 'temporary', code: 'TIMEOUT' };
  if (error instanceof ApiError) {
    const { status, code } = error;
    if (status === 401) return { kind: 'session', code };
    if (code && CONFLICT_CODES.has(code)) return { kind: 'conflict', code };
    if (code && LIMIT_CODES.has(code))
      return { kind: 'limit', code, ...(error.resetsAt ? { resetsAt: error.resetsAt } : {}) };
    // A 2xx the app could not read, a fault, or anything the server says to retry.
    if (status < 400 || status >= 500 || status === 429 || error.retryable)
      return { kind: 'temporary', code };
    return { kind: 'refused', code };
  }
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && CONFLICT_CODES.has(code)) return { kind: 'conflict', code };
  // fetch rejects with a TypeError when the network is gone or the connection drops.
  if (error instanceof TypeError) return { kind: 'temporary', code: 'NETWORK' };
  return { kind: 'temporary' };
}
