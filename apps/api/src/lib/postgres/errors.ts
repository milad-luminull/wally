/**
 * What a PostgreSQL failure means for Wally, by SQLSTATE
 * (https://www.postgresql.org/docs/current/errcodes-appendix.html). Which Wally error each
 * kind becomes is decided where the call is made; this only names the kind.
 */
export type DatabaseErrorKind = 'serialization' | 'deadlock' | 'unique' | 'foreignKey' | 'check';

const KINDS: Record<string, DatabaseErrorKind> = {
  '40001': 'serialization',
  '40P01': 'deadlock',
  '23505': 'unique',
  '23503': 'foreignKey',
  '23514': 'check',
};

/** Reads the SQLSTATE on the error itself or, as Drizzle wraps driver errors, its cause. */
export function classifyDatabaseError(error: unknown): DatabaseErrorKind | null {
  if (typeof error !== 'object' || error === null) return null;
  const failure = error as { code?: unknown; cause?: { code?: unknown } };
  const code = typeof failure.code === 'string' ? failure.code : failure.cause?.code;
  return typeof code === 'string' ? (KINDS[code] ?? null) : null;
}

/** withTransaction ran out of attempts against concurrent writers; `cause` is the last failure. */
export class TransactionConflictError extends Error {
  readonly attempts: number;

  constructor(attempts: number, cause: unknown) {
    super(`Transaction still conflicted after ${attempts} attempts`, { cause });
    this.name = 'TransactionConflictError';
    this.attempts = attempts;
  }
}
