import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '../../../../test/postgres.js';
import {
  assistantAudit,
  assistantSpend,
  boardCleanup,
  boardOperations,
  users,
  whiteboards,
} from './index.js';

const at = new Date('2026-10-27T09:00:00.000Z');
const later = new Date('2026-11-03T09:00:00.000Z');

const TABLES = [
  'assistant_attempts',
  'assistant_audit',
  'assistant_conversations',
  'assistant_spend',
  'assistant_suggestions',
  'assistant_tidies',
  'assistant_usage',
  'auth_identities',
  'board_cleanup',
  'board_members',
  'board_operations',
  'mcp_connections',
  'mcp_limits',
  'note_history',
  'notes',
  'share_links',
  'subtasks',
  'users',
  'whiteboards',
];

const EXPIRING = [
  'board_operations',
  'assistant_audit',
  'assistant_attempts',
  'assistant_conversations',
  'assistant_suggestions',
  'assistant_tidies',
];

describe('the whole schema', () => {
  let handle: TestDatabase;

  beforeAll(async () => {
    handle = await createTestDatabase();
  });

  afterAll(async () => {
    await handle?.drop();
  });

  it('creates exactly the 19 tables', async () => {
    const rows = await handle.sql<{ tablename: string }[]>`
      select tablename from pg_tables where schemaname = 'public' order by 1`;
    expect(rows.map((row) => row.tablename)).toEqual(TABLES);
  });

  it('enables row level security on every table', async () => {
    const rows = await handle.sql<{ relname: string }[]>`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`;
    expect(rows).toEqual([]);
  });

  it('indexes expires_at on the six expiring tables, and never expires cleanup jobs', async () => {
    for (const table of EXPIRING) {
      const indexes = await handle.sql<{ indexdef: string }[]>`
        select indexdef from pg_indexes where schemaname = 'public' and tablename = ${table}`;
      expect(
        indexes.some((index) => index.indexdef.includes('(expires_at)')),
        table,
      ).toBe(true);
    }
    const [cleanup] = await handle.sql`
      select count(*)::int as n from information_schema.columns
      where table_name = 'board_cleanup' and column_name = 'expires_at'`;
    expect(cleanup!.n).toBe(0);
  });

  it('keeps receipts, audit and cleanup jobs when their board is deleted', async () => {
    const { db } = handle;
    await db.insert(users).values({
      id: 'u1',
      email: 'max@example.com',
      emailVerified: true,
      language: 'en',
      createdAt: at,
      updatedAt: at,
    });
    await db
      .insert(whiteboards)
      .values({ id: 'b1', ownerId: 'u1', name: 'Launch', createdAt: at, updatedAt: at });
    await db.insert(boardOperations).values({
      userId: 'u1',
      operationId: 'op1',
      fingerprint: 'f',
      boardId: 'b1',
      roles: ['OWNER'],
      result: { status: 204, revision: 2, data: null, boardId: 'b1', cleanupId: 'u1_op1' },
      createdAt: at,
      expiresAt: later,
    });
    await db.insert(assistantAudit).values({
      operationId: 'op1',
      actorId: 'u1',
      boardId: 'b1',
      commandType: 'board.delete',
      revision: 2,
      occurredAt: at,
      expiresAt: later,
    });
    await db
      .insert(boardCleanup)
      .values({ id: 'u1_op1', kind: 'board.delete', boardId: 'b1', createdAt: at });

    await db.delete(whiteboards).where(eq(whiteboards.id, 'b1'));

    expect(await db.$count(boardOperations)).toBe(1);
    expect(await db.$count(assistantAudit)).toBe(1);
    expect(await db.$count(boardCleanup)).toBe(1);
  });

  it('returns large micro-USD sums as exact numbers', async () => {
    await handle.db
      .insert(assistantSpend)
      .values({ month: '2026-10', microUsd: 5_000_000_000, updatedAt: at });
    const [row] = await handle.db.select().from(assistantSpend);
    expect(typeof row!.microUsd).toBe('number');
    expect(row!.microUsd).toBe(5_000_000_000);
  });
});
