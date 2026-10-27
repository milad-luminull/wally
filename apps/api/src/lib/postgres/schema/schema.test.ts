import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '../../../../test/postgres.js';
import {
  assistantAudit,
  assistantSpend,
  assistantSuggestions,
  boardCleanup,
  boardOperations,
  mcpConnections,
  users,
  whiteboards,
} from './index.js';

/** The Postgres error code, which Drizzle wraps in its own query error. */
async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    const failure = error as { code?: string; cause?: { code?: string } };
    return failure.code ?? failure.cause?.code;
  }
  throw new Error('expected the statement to be rejected');
}

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

  it('indexes the per-user lookups of memberships and MCP connections', async () => {
    const indexes = await handle.sql<{ indexdef: string }[]>`
      select indexdef from pg_indexes
      where schemaname = 'public' and tablename in ('board_members', 'mcp_connections')`;
    const defs = indexes.map((index) => index.indexdef);
    expect(
      defs.some((def) => def.includes('board_members') && def.endsWith('(user_id, status)')),
    ).toBe(true);
    expect(
      defs.some(
        (def) =>
          def.includes('mcp_connections') &&
          !def.includes('UNIQUE') &&
          def.endsWith('(user_id, client_id)'),
      ),
    ).toBe(true);
  });

  it('holds receipt roles, audit values, typed fields and scopes to their allowed values', async () => {
    const { db } = handle;
    await db.insert(users).values({
      id: 'u9',
      email: 'ana@example.com',
      emailVerified: true,
      language: 'en',
      createdAt: at,
      updatedAt: at,
    });
    const receipt = {
      userId: 'u9',
      operationId: 'op9',
      fingerprint: 'f',
      boardId: 'b9',
      roles: ['OWNER' as const],
      result: { status: 200, revision: 1, data: null, boardId: 'b9' },
      createdAt: at,
      expiresAt: later,
    };
    const audit = {
      operationId: 'op9',
      actorId: 'u9',
      boardId: 'b9',
      commandType: 'note.update' as const,
      revision: 1,
      occurredAt: at,
      expiresAt: later,
    };
    const suggestion = {
      id: 's9',
      userId: 'u9',
      boardId: 'b9',
      noteId: 'n9',
      baseRevision: 1,
      fields: { dueDate: null, priority: null, assignee: null },
      operationIds: {
        dueDate: { apply: 'a1', undo: 'u1' },
        priority: { apply: 'a2', undo: 'u2' },
        assignee: { apply: 'a3', undo: 'u3' },
      },
      status: 'PENDING' as const,
      model: 'vertex:gemini',
      usage: { inputTokens: 1, outputTokens: 1 },
      createdAt: at,
      updatedAt: at,
      expiresAt: later,
    };
    const connection = {
      id: 'c9',
      userId: 'u9',
      clientId: 'chatgpt',
      name: 'ChatGPT',
      createdAt: at,
      issuedAfter: 1,
    };
    type Any = never;

    expect(
      await codeOf(db.insert(boardOperations).values({ ...receipt, roles: ['ADMIN' as Any] })),
    ).toBe('23514');
    expect(
      await codeOf(
        db.insert(assistantAudit).values({ ...audit, commandType: 'note.explode' as Any }),
      ),
    ).toBe('23514');
    expect(await codeOf(db.insert(assistantAudit).values({ ...audit, via: 'web' as Any }))).toBe(
      '23514',
    );
    expect(
      await codeOf(
        db.insert(assistantSuggestions).values({ ...suggestion, typed: ['colour' as Any] }),
      ),
    ).toBe('23514');
    expect(await codeOf(db.insert(mcpConnections).values({ ...connection, scopes: [] }))).toBe(
      '23514',
    );

    // The allowed values still go in.
    await db.insert(boardOperations).values(receipt);
    await db.insert(assistantAudit).values({ ...audit, via: 'mcp', connectionId: 'c9' });
    await db.insert(assistantSuggestions).values({ ...suggestion, typed: ['dueDate'] });
    await db.insert(mcpConnections).values({ ...connection, scopes: ['wally:read'] });
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
