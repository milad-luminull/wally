import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '../../../../test/postgres.js';
import {
  boardMembers,
  mcpConnections,
  noteHistory,
  notes,
  shareLinks,
  subtasks,
  users,
  whiteboards,
} from './index.js';

const at = new Date('2026-10-27T09:00:00.000Z');

/** The Postgres error code, which Drizzle wraps in its own query error. */
function pgCode(error: unknown): string | undefined {
  const failure = error as { code?: string; cause?: { code?: string } };
  return failure.code ?? failure.cause?.code;
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return pgCode(error);
  }
  throw new Error('expected the statement to be rejected');
}

const note = (overrides: Partial<typeof notes.$inferInsert> = {}): typeof notes.$inferInsert => ({
  id: 'n1',
  boardId: 'b1',
  title: 'Book the venue',
  status: 'OPEN',
  priority: 'MEDIUM',
  horizon: 'THIS_WEEK',
  freeX: 10,
  freeY: 20,
  colour: 'CHALK',
  createdById: 'u1',
  createdAt: at,
  updatedAt: at,
  ...overrides,
});

describe('accounts, boards and notes tables', () => {
  let handle: TestDatabase;

  beforeAll(async () => {
    handle = await createTestDatabase();
  });

  afterAll(async () => {
    await handle?.drop();
  });

  beforeEach(async () => {
    await handle.db.execute(sql`truncate users, whiteboards cascade`);
    await handle.db.insert(users).values([
      {
        id: 'u1',
        email: 'max@example.com',
        emailVerified: true,
        language: 'en',
        createdAt: at,
        updatedAt: at,
      },
      {
        id: 'u2',
        email: 'ana@example.com',
        emailVerified: true,
        language: 'en',
        createdAt: at,
        updatedAt: at,
      },
    ]);
    await handle.db
      .insert(whiteboards)
      .values({ id: 'b1', ownerId: 'u1', name: 'Launch', createdAt: at, updatedAt: at });
  });

  it('deleting a board removes its members, share link, notes, subtasks and history', async () => {
    const { db } = handle;
    await db.insert(boardMembers).values({
      id: 'm1',
      boardId: 'b1',
      userId: 'u2',
      invitedEmail: null,
      role: 'EDIT',
      status: 'ACTIVE',
      invitedAt: at,
      activatedAt: at,
    });
    await db
      .insert(shareLinks)
      .values({ token: 't1', boardId: 'b1', role: 'VIEW', createdAt: at, updatedAt: at });
    await db.insert(notes).values(note());
    await db.insert(subtasks).values({
      id: 's1',
      noteId: 'n1',
      text: 'Call the hall',
      done: false,
      sortIndex: 0,
      createdAt: at,
      updatedAt: at,
    });
    await db
      .insert(noteHistory)
      .values({ id: 'h1', noteId: 'n1', type: 'CREATED', occurredAt: at, actorId: 'u1' });

    await db.delete(whiteboards).where(eq(whiteboards.id, 'b1'));

    const counts = await Promise.all(
      [boardMembers, shareLinks, notes, subtasks, noteHistory].map((table) => db.$count(table)),
    );
    expect(counts).toEqual([0, 0, 0, 0, 0]);
  });

  it('rejects a private note that is not assigned to its author', async () => {
    const code = await codeOf(
      handle.db
        .insert(notes)
        .values(note({ visibility: 'PRIVATE', createdById: 'u1', assigneeId: 'u2' })),
    );
    expect(code).toBe('23514');
  });

  it('rejects a private note with no assignee', async () => {
    const code = await codeOf(
      handle.db
        .insert(notes)
        .values(note({ visibility: 'PRIVATE', createdById: 'u1', assigneeId: null })),
    );
    expect(code).toBe('23514');
  });

  it('allows one active MCP connection per user and client', async () => {
    const connection = (id: string) => ({
      id,
      userId: 'u1',
      clientId: 'chatgpt',
      name: 'ChatGPT',
      scopes: ['wally:read', 'wally:write'] as ('wally:read' | 'wally:write')[],
      createdAt: at,
      issuedAfter: 1_761_555_600,
    });
    await handle.db.insert(mcpConnections).values(connection('c1'));
    expect(await codeOf(handle.db.insert(mcpConnections).values(connection('c2')))).toBe('23505');

    await handle.db
      .update(mcpConnections)
      .set({ revokedAt: at })
      .where(eq(mcpConnections.id, 'c1'));
    await handle.db.insert(mcpConnections).values(connection('c3'));
    expect(await handle.db.$count(mcpConnections)).toBe(2);
  });

  it('rejects a value outside the shared enum', async () => {
    const code = await codeOf(
      handle.db.insert(notes).values(note({ status: 'ARCHIVED' as 'OPEN' })),
    );
    expect(code).toBe('23514');
  });

  it('round-trips a due date on a DST change day', async () => {
    await handle.db.insert(notes).values(note({ dueDate: '2026-03-29' }));
    const [row] = await handle.db.select().from(notes).where(eq(notes.id, 'n1'));
    expect(row!.dueDate).toBe('2026-03-29');
  });
});
