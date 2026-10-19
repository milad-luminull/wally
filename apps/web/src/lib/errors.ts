/** A request that got no answer within its time limit; sending it again may work. */
export class RequestTimeoutError extends Error {
  constructor() {
    super('The request took too long');
    this.name = 'RequestTimeoutError';
  }
}

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
  // An ApiError, or any error that carries an HTTP status the same way.
  const fields = (error ?? {}) as {
    status?: unknown;
    code?: unknown;
    retryable?: unknown;
    resetsAt?: unknown;
  };
  const code = typeof fields.code === 'string' ? fields.code : undefined;
  if (code && CONFLICT_CODES.has(code)) return { kind: 'conflict', code };
  if (typeof fields.status === 'number') {
    const status = fields.status;
    // Already sent again with a fresh token: the API's own check failed, not the session (a
    // session that really ended is signed out by Firebase itself). Worth another try.
    if (status === 401) return { kind: 'temporary', code };
    if (code && LIMIT_CODES.has(code))
      return {
        kind: 'limit',
        code,
        ...(typeof fields.resetsAt === 'string' ? { resetsAt: fields.resetsAt } : {}),
      };
    // A 2xx the app could not read, a fault, or anything the server says to retry.
    if (status < 400 || status >= 500 || status === 429 || fields.retryable === true)
      return { kind: 'temporary', code };
    return { kind: 'refused', code };
  }
  // fetch rejects with a TypeError when the network is gone or the connection drops.
  if (error instanceof TypeError) return { kind: 'temporary', code: 'NETWORK' };
  return { kind: 'temporary', code };
}
