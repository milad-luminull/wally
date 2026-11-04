import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asc, eq, sql } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '../../../../test/postgres.js';
import { assistantAudit, boardMembers, noteHistory, notes, users, whiteboards } from './index.js';

const at = new Date('2026-11-04T09:00:00.000Z');

function pgCode(error: unknown): string | undefined {
  const failure = error as { code?: string; cause?: { code?: string } };
  return failure.code ?? failure.cause?.code;
}

const user = (id: string) => ({
  id,
  email: `${id}@example.com`,
  emailVerified: true,
  language: 'en' as const,
  createdAt: at,
  updatedAt: at,
});
const board = (id: string, ownerId: string) => ({
  id,
  ownerId,
  name: id,
  createdAt: at,
  updatedAt: at,
});
const note = (
  id: string,
  boardId: string,
  overrides: Partial<typeof notes.$inferInsert> = {},
): typeof notes.$inferInsert => ({
  id,
  boardId,
  title: id,
  status: 'OPEN',
  priority: 'MEDIUM',
  horizon: 'THIS_WEEK',
  freeX: 0,
  freeY: 0,
  colour: 'CHALK',
  createdAt: at,
  updatedAt: at,
  ...overrides,
});
const audit = (operationId: string, actorId: string) => ({
  operationId,
  actorId,
  boardId: 'b-other',
  commandType: 'note.update' as const,
  revision: 1,
  occurredAt: at,
  expiresAt: new Date(at.getTime() + 86_400_000),
});

describe('deleting a user erases their rows by foreign key', () => {
  let handle: TestDatabase;

  beforeAll(async () => {
    handle = await createTestDatabase();
  });

  afterAll(async () => {
    await handle?.drop();
  });

  beforeEach(async () => {
    const db = handle.db;
    await db.execute(sql`truncate users, whiteboards, assistant_audit cascade`);
    await db.insert(users).values([user('owner'), user('member'), user('other')]);
    await db.insert(whiteboards).values([board('b-own', 'owner'), board('b-other', 'other')]);
    await db.insert(boardMembers).values([
      {
        id: 'm1',
        boardId: 'b-own',
        userId: 'member',
        role: 'EDIT',
        status: 'ACTIVE',
        invitedAt: at,
      },
      {
        id: 'm2',
        boardId: 'b-other',
        userId: 'owner',
        role: 'EDIT',
        status: 'ACTIVE',
        invitedAt: at,
      },
    ]);
    await db.insert(notes).values([
      note('n-own-board', 'b-own', { createdById: 'member' }),
      note('n-mine', 'b-other', { createdById: 'owner' }),
      note('n-private', 'b-other', {
        createdById: 'owner',
        assigneeId: 'owner',
        visibility: 'PRIVATE',
      }),
      note('n-assigned', 'b-other', { createdById: 'other', assigneeId: 'owner' }),
    ]);
    await db.insert(noteHistory).values([
      { id: 'h1', noteId: 'n-assigned', type: 'CREATED', occurredAt: at, actorId: 'other' },
      { id: 'h2', noteId: 'n-assigned', type: 'MOVED', occurredAt: at, actorId: 'owner' },
    ]);
    await db.insert(assistantAudit).values([audit('op1', 'owner'), audit('op2', 'other')]);
  });

  it('removes their boards, notes, history, memberships and audit rows, and unassigns the rest', async () => {
    const db = handle.db;
    await db.delete(notes).where(eq(notes.createdById, 'owner'));
    await db.delete(users).where(eq(users.id, 'owner'));

    const boardIds = (await db.select({ id: whiteboards.id }).from(whiteboards)).map((r) => r.id);
    expect(boardIds).toEqual(['b-other']);
    const noteRows = await db.select().from(notes).orderBy(asc(notes.id));
    expect(noteRows.map((n) => n.id)).toEqual(['n-assigned']);
    expect(noteRows[0]!.assigneeId).toBeNull();
    const actors = (await db.select({ actorId: noteHistory.actorId }).from(noteHistory)).map(
      (r) => r.actorId,
    );
    expect(actors).toEqual(['other']);
    const memberIds = (await db.select({ userId: boardMembers.userId }).from(boardMembers)).map(
      (r) => r.userId,
    );
    expect(memberIds).not.toContain('owner');
    const auditActors = (
      await db.select({ actorId: assistantAudit.actorId }).from(assistantAudit)
    ).map((r) => r.actorId);
    expect(auditActors).toEqual(['other']);
  });

  it('refuses a note whose creator does not exist', async () => {
    let code: string | undefined;
    try {
      await handle.db.insert(notes).values(note('n-ghost', 'b-other', { createdById: 'ghost' }));
    } catch (error) {
      code = pgCode(error);
    }
    expect(code).toBe('23503');
  });
});
