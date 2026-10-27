import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { runQueryTransaction } from './transaction.js';

// Runs the body once with no retries, so the test sees exactly what reaches the SDK.
const db = { runTransaction: (body: (tx: unknown) => unknown) => body({}) } as unknown as Firestore;

describe('runQueryTransaction', () => {
  it("turns the emulator's closed-transaction error into a retryable ABORTED", async () => {
    const closed = Object.assign(new Error('closed'), {
      code: 3,
      details: 'Transaction is invalid or closed.',
    });
    await expect(
      runQueryTransaction(db, async () => {
        throw closed;
      }),
    ).rejects.toMatchObject({ code: 10 });
  });

  it('passes every other error through unchanged, including other invalid arguments', async () => {
    const invalid = Object.assign(new Error('bad'), { code: 3, details: 'Bad field.' });
    await expect(
      runQueryTransaction(db, async () => {
        throw invalid;
      }),
    ).rejects.toBe(invalid);
  });

  it('returns the body result', async () => {
    await expect(runQueryTransaction(db, async () => 'ok')).resolves.toBe('ok');
  });
});
