import { setTimeout as delay } from 'node:timers/promises';
import type { Database } from './client.js';
import { TransactionConflictError, classifyDatabaseError } from './errors.js';

export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 10;
const MAX_DELAY_MS = 200;

/**
 * Runs `body` as one SERIALIZABLE transaction, the rule every PostgreSQL write in Wally
 * follows (docs/superpowers/specs/2026-10-27-postgres-foundation-design.md).
 *
 * Firestore's transactions were serializable and retried by its SDK, and Wally's
 * invariants (the board limit, stale revisions, receipts, budgets) rely on that. PostgreSQL
 * gives the same guarantee at this level, but reports a conflict as a serialization failure
 * or deadlock and expects the caller to retry
 * (https://www.postgresql.org/docs/current/transaction-iso.html). So the whole body runs
 * again, after a jittered exponential wait, up to `maxAttempts` times; then it throws
 * TransactionConflictError. Any other error is thrown at once, as it came.
 *
 * `body` may run more than once: it must not have effects outside the transaction.
 */
export async function withTransaction<T>(
  db: Database,
  body: (tx: Transaction) => Promise<T>,
  options: {
    maxAttempts?: number;
    random?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? ((ms: number) => delay(ms));

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await db.transaction(body, { isolationLevel: 'serializable' });
    } catch (error) {
      const kind = classifyDatabaseError(error);
      if (kind !== 'serialization' && kind !== 'deadlock') throw error;
      if (attempt >= maxAttempts) throw new TransactionConflictError(attempt, error);
      await sleep(random() * Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt));
    }
  }
}

/**
 * Runs `body` as one read-only transaction on a single snapshot (REPEATABLE READ), what
 * Firestore's read-only transactions gave the board and note queries: every read sees the
 * same moment. A read-only snapshot never fails with a serialization error, so there is
 * nothing to retry.
 */
export function withSnapshot<T>(db: Database, body: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(body, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}
