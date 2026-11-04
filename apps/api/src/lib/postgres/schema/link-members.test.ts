import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asc, eq, sql } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '../../../../test/postgres.js';
import { boardMembers, notes, users, whiteboards } from './index.js';

const at = new Date('2026-11-04T09:00:00.000Z');
const later = new Date('2026-11-04T10:00:00.000Z');

const user = (id: string) => ({
  id,
  email: `${id}@example.com`,
  emailVerified: true,
  language: 'en' as const,
  createdAt: at,
  updatedAt: at,
});
const board = (id: string) => ({ id, ownerId: 'owner', name: id, createdAt: at, updatedAt: at });
const member = (
  id: string,
  boardId: string,
  userId: string,
  joinedByLink: boolean,
): typeof boardMembers.$inferInsert => ({
  id,
  boardId,
  userId,
  role: 'EDIT',
  status: 'ACTIVE',
  invitedAt: at,
  joinedByLink,
});
const note = (
  id: string,
  boardId: string,
  assigneeId: string,
  visibility: 'SHARED' | 'PRIVATE' = 'SHARED',
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
  createdById: assigneeId,
  assigneeId,
  visibility,
  createdAt: at,
  updatedAt: at,
});

describe('release_assignments and remove_link_members', () => {
  let handle: TestDatabase;

  beforeAll(async () => {
    handle = await createTestDatabase();
  });

  afterAll(async () => {
    await handle?.drop();
  });

  beforeEach(async () => {
    const db = handle.db;
    await db.execute(sql`truncate users, whiteboards cascade`);
    await db
      .insert(users)
      .values(['owner', 'linked', 'both', 'invited', 'elsewhere'].map((id) => user(id)));
    await db.insert(whiteboards).values([board('b1'), board('b2')]);
    await db.insert(boardMembers).values([
      member('m-linked', 'b1', 'linked', true),
      // Joined by link and also holds an invited row: still a member after the link goes.
      member('m-both-link', 'b1', 'both', true),
      member('m-both-invite', 'b1', 'both', false),
      member('m-invited', 'b1', 'invited', false),
      member('m-elsewhere', 'b2', 'elsewhere', true),
    ]);
    await db
      .insert(notes)
      .values([
        note('n-linked', 'b1', 'linked'),
        note('n-linked-private', 'b1', 'linked', 'PRIVATE'),
        note('n-both', 'b1', 'both'),
        note('n-owner', 'b1', 'owner'),
        note('n-elsewhere', 'b2', 'elsewhere'),
      ]);
  });

  const assignee = async (id: string) =>
    (await handle.db.select().from(notes).where(eq(notes.id, id)))[0]!;

  it('a new member row is not joined by link unless it says so', async () => {
    await handle.db
      .insert(boardMembers)
      .values({
        id: 'm-new',
        boardId: 'b2',
        userId: 'invited',
        role: 'VIEW',
        status: 'ACTIVE',
        invitedAt: at,
      });
    const [row] = await handle.db.select().from(boardMembers).where(eq(boardMembers.id, 'm-new'));
    expect(row!.joinedByLink).toBe(false);
  });

  it('release_assignments unassigns shared notes of a non-member and keeps private ones', async () => {
    await handle.db.delete(boardMembers).where(eq(boardMembers.id, 'm-linked'));
    const [result] = await handle.db.execute<{ released: number }>(
      sql`select release_assignments('b1', 'linked', ${later.toISOString()}::timestamptz) as released`,
    );
    expect(Number(result!.released)).toBe(1);

    const shared = await assignee('n-linked');
    expect(shared.assigneeId).toBeNull();
    expect(shared.revision).toBe(2);
    expect(shared.updatedAt).toEqual(later);
    expect((await assignee('n-linked-private')).assigneeId).toBe('linked');
  });

  it('release_assignments leaves the owner and anyone still a member alone', async () => {
    for (const person of ['owner', 'both', 'linked']) {
      const [result] = await handle.db.execute<{ released: number }>(
        sql`select release_assignments('b1', ${person}, ${later.toISOString()}::timestamptz) as released`,
      );
      expect(Number(result!.released)).toBe(0);
    }
    expect((await assignee('n-owner')).assigneeId).toBe('owner');
    expect((await assignee('n-both')).assigneeId).toBe('both');
    expect((await assignee('n-linked')).assigneeId).toBe('linked');
  });

  it('remove_link_members removes only that board’s link members and releases their notes', async () => {
    const [result] = await handle.db.execute<{ removed: number }>(
      sql`select remove_link_members('b1', ${later.toISOString()}::timestamptz) as removed`,
    );
    expect(Number(result!.removed)).toBe(2);

    const left = await handle.db
      .select({ id: boardMembers.id })
      .from(boardMembers)
      .orderBy(asc(boardMembers.id));
    expect(left.map((row) => row.id)).toEqual(['m-both-invite', 'm-elsewhere', 'm-invited']);

    expect((await assignee('n-linked')).assigneeId).toBeNull();
    expect((await assignee('n-linked-private')).assigneeId).toBe('linked');
    expect((await assignee('n-both')).assigneeId).toBe('both');
    expect((await assignee('n-elsewhere')).assigneeId).toBe('elsewhere');
  });

  it('remove_link_members on a board without link members removes nothing', async () => {
    await handle.db.delete(boardMembers).where(eq(boardMembers.boardId, 'b2'));
    const [result] = await handle.db.execute<{ removed: number }>(
      sql`select remove_link_members('b2', ${later.toISOString()}::timestamptz) as removed`,
    );
    expect(Number(result!.removed)).toBe(0);
  });
});
