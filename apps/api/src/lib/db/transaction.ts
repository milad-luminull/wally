import type { Firestore, Transaction } from 'firebase-admin/firestore';

/**
 * `db.runTransaction` for transactions that run a query. The emulator can report an
 * aborted query as INVALID_ARGUMENT with a closed transaction, which SDK 7.x otherwise
 * retries only for "transaction has expired". Normalize just this transient condition;
 * the SDK retries the complete transaction with its existing bounded backoff. Invalid
 * arguments are never retried.
 */
export function runQueryTransaction<T>(
  db: Firestore,
  body: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.runTransaction(async (tx) => {
    try {
      return await body(tx);
    } catch (error) {
      const failure = error as { code?: number; details?: string };
      if (failure.code === 3 && failure.details === 'Transaction is invalid or closed.') {
        throw Object.assign(new Error('Transaction was aborted'), { code: 10 });
      }
      throw error;
    }
  });
}
