import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, count, eq, isNull, sql } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import type { Database } from './client.js';
import { TransactionConflictError } from './errors.js';
import { notes, users, whiteboards } from './schema/index.js';
import { withTransaction, type Transaction } from './transaction.js';

/**
 * The transaction rule, proven on the real schema with the invariants Firestore's
 * serializable transactions used to keep (RFC-0008). Each body sleeps between its read and
 * its write so the transactions really overlap. These are test-only SQL, not the
 * repository code workstream 2 will write.
 */

const at = new Date('2026-10-27T09:00:00.000Z');
const BOARD_LIMIT = 20;
const overlap = (tx: Transaction | Database) => tx.execute(sql`select pg_sleep(0.05)`);

describe('serializable transactions keep the invariants under concurrency', () => {
  let handle: TestDatabase;

  beforeAll(async () => {
    handle = await createTestDatabase({ max: 10 });
  });

  afterAll(async () => {
    await handle?.drop();
  });

  beforeEach(async () => {
    await handle.db.execute(sql`truncate users, whiteboards cascade`);
    await handle.db.insert(users).values({
      id: 'u1',
      email: 'max@example.com',
      emailVerified: true,
      language: 'en',
      createdAt: at,
      updatedAt: at,
    });
    await handle.db.insert(whiteboards).values(
      Array.from({ length: 15 }, (_, index) => ({
        id: `existing-${index}`,
        ownerId: 'u1',
        name: `Board ${index}`,
        createdAt: at,
        updatedAt: at,
      })),
    );
  });

  /** Counts the owner's live boards, waits, then creates one if the limit allows. */
  const createBoard = async (tx: Transaction | Database, id: string) => {
    const [row] = await tx
      .select({ boards: count() })
      .from(whiteboards)
      .where(and(eq(whiteboards.ownerId, 'u1'), isNull(whiteboards.deletedAt)));
    await overlap(tx);
    if (row!.boards >= BOARD_LIMIT) return 'limit' as const;
    await tx
      .insert(whiteboards)
      .values({ id, ownerId: 'u1', name: id, createdAt: at, updatedAt: at });
    return 'created' as const;
  };

  const liveBoards = () => handle.db.$count(whiteboards, eq(whiteboards.ownerId, 'u1'));

  it('never lets an owner pass 20 boards', async () => {
    const outcomes = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        // Ten writers on one owner commit about one per retry wave, so the default five
        // attempts leave no margin; ten let every caller finish with 'created' or 'limit'.
        withTransaction(handle.db, (tx) => createBoard(tx, `new-${index}`), {
          maxAttempts: 10,
        }).catch((error: unknown) => {
          if (error instanceof TransactionConflictError) return 'conflict' as const;
          throw error;
        }),
      ),
    );
    expect(await liveBoards()).toBe(BOARD_LIMIT);
    const tally = (wanted: string) => outcomes.filter((outcome) => outcome === wanted).length;
    expect({
      created: tally('created'),
      limit: tally('limit'),
      conflict: tally('conflict'),
    }).toEqual({
      created: 5,
      limit: 5,
      conflict: 0,
    });
  });

  it('lets exactly one of two writers advance a note revision', async () => {
    await handle.db.insert(notes).values({
      id: 'n1',
      boardId: 'existing-0',
      title: 'Book the venue',
      status: 'OPEN',
      priority: 'MEDIUM',
      horizon: 'TODAY',
      freeX: 0,
      freeY: 0,
      colour: 'CHALK',
      createdAt: at,
      updatedAt: at,
    });
    const advance = () =>
      withTransaction(handle.db, async (tx) => {
        const [note] = await tx
          .select({ revision: notes.revision })
          .from(notes)
          .where(eq(notes.id, 'n1'));
        await overlap(tx);
        if (note!.revision !== 1) return 'stale' as const;
        await tx.update(notes).set({ revision: 2 }).where(eq(notes.id, 'n1'));
        return 'ok' as const;
      });

    const outcomes = await Promise.all([advance(), advance()]);

    expect(outcomes.sort()).toEqual(['ok', 'stale']);
    const [note] = await handle.db.select({ revision: notes.revision }).from(notes);
    expect(note!.revision).toBe(2);
  });

  it('shows the board limit breaks without the helper', async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        handle.db.transaction((tx) => createBoard(tx, `unguarded-${index}`)),
      ),
    );
    expect(await liveBoards()).toBeGreaterThan(BOARD_LIMIT);
  });
});
