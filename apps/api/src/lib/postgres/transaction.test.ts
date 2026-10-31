import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { TransactionConflictError } from './errors.js';
import { users } from './schema/index.js';
import { withSnapshot, withTransaction } from './transaction.js';

const at = new Date('2026-10-27T09:00:00.000Z');
const serializationFailure = () =>
  Object.assign(new Error('could not serialize'), { code: '40001' });

describe('withTransaction', () => {
  let handle: TestDatabase;
  let waits: number[];
  const options = () => ({
    random: () => 1,
    sleep: async (ms: number) => {
      waits.push(ms);
    },
  });

  beforeAll(async () => {
    handle = await createTestDatabase();
  });

  afterAll(async () => {
    await handle?.drop();
  });

  beforeEach(async () => {
    waits = [];
    await handle.db.execute(sql`truncate users cascade`);
  });

  it('runs the body at serializable isolation', async () => {
    const level = await withTransaction(handle.db, async (tx) => {
      const [row] = await tx.execute<{ level: string }>(
        sql`select current_setting('transaction_isolation') as level`,
      );
      return row!.level;
    });
    expect(level).toBe('serializable');
  });

  it('retries a serialization failure and then succeeds', async () => {
    let calls = 0;
    const result = await withTransaction(
      handle.db,
      async () => {
        calls += 1;
        if (calls < 3) throw serializationFailure();
        return 'ok';
      },
      options(),
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
    // random() = 1 gives each wait its cap: min(200, 10 * 2 ** attempt).
    expect(waits).toEqual([20, 40]);
  });

  it('gives up after five attempts', async () => {
    let calls = 0;
    const failure = await withTransaction(
      handle.db,
      async () => {
        calls += 1;
        throw serializationFailure();
      },
      options(),
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TransactionConflictError);
    expect((failure as TransactionConflictError).attempts).toBe(5);
    expect(calls).toBe(5);
    expect(waits).toEqual([20, 40, 80, 160]);
  });

  it('does not retry other errors', async () => {
    let calls = 0;
    const unique = Object.assign(new Error('duplicate key'), { code: '23505' });
    const failure = await withTransaction(
      handle.db,
      async () => {
        calls += 1;
        throw unique;
      },
      options(),
    ).catch((error: unknown) => error);
    expect(failure).toBe(unique);
    expect(calls).toBe(1);
  });

  it('rolls back every write of a failed attempt', async () => {
    let calls = 0;
    await withTransaction(
      handle.db,
      async (tx) => {
        calls += 1;
        await tx.insert(users).values({
          id: `u${calls}`,
          email: 'max@example.com',
          emailVerified: true,
          language: 'en',
          createdAt: at,
          updatedAt: at,
        });
        if (calls === 1) throw serializationFailure();
      },
      options(),
    );
    const rows = await handle.db.select({ id: users.id }).from(users);
    expect(rows).toEqual([{ id: 'u2' }]);
  });
});

describe('withSnapshot', () => {
  let handle: TestDatabase;

  beforeAll(async () => {
    handle = await createTestDatabase();
  });

  afterAll(async () => {
    await handle?.drop();
  });

  it('reads one repeatable-read snapshot and refuses writes', async () => {
    const settings = await withSnapshot(handle.db, async (tx) => {
      const [row] = await tx.execute<{ level: string; readOnly: string }>(
        sql`select current_setting('transaction_isolation') as level,
                   current_setting('transaction_read_only') as "readOnly"`,
      );
      return row!;
    });
    expect(settings).toEqual({ level: 'repeatable read', readOnly: 'on' });

    const write = withSnapshot(handle.db, (tx) =>
      tx.insert(users).values({
        id: 'u1',
        email: 'u1@example.com',
        emailVerified: true,
        language: 'en',
        createdAt: at,
        updatedAt: at,
      }),
    );
    await expect(write).rejects.toMatchObject({ cause: { code: '25006' } });
  });
});
