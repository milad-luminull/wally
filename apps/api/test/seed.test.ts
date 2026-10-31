import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { seedDemo } from '../src/seed.js';
import { liveBoard } from '../src/lib/db/records.js';
import {
  boardMembers,
  noteHistory,
  notes,
  shareLinks,
  subtasks,
  users,
} from '../src/lib/postgres/schema/index.js';
import { createTestDatabase, type TestDatabase } from './helpers.js';

describe('the demo seed', () => {
  let handle: TestDatabase;

  beforeAll(async () => {
    handle = await createTestDatabase();
  });

  afterAll(async () => {
    await handle?.drop();
  });

  it('writes the demo board and can run again without duplicating anything', async () => {
    const { db } = handle;
    const token = await seedDemo(db);
    const counts = async () =>
      Promise.all(
        [users, boardMembers, notes, subtasks, noteHistory, shareLinks].map((t) => db.$count(t)),
      );
    const first = await counts();
    expect(first).toEqual([3, 3, 10, 8, 12, 1]);

    expect(await seedDemo(db)).toBe(token);
    expect(await counts()).toEqual(first);

    const board = await liveBoard(db, 'seed-owner');
    expect(board).toMatchObject({
      ownerId: 'seed-owner',
      revision: 2,
      shareLinkToken: token,
      memberRoles: { 'seed-colleague-edit': 'EDIT', 'seed-colleague-view': 'VIEW' },
    });
    const [pending] = await db
      .select()
      .from(boardMembers)
      .where(eq(boardMembers.id, 'seed-member-pending'));
    expect(pending).toMatchObject({ status: 'PENDING', invitedEmail: 'robin.vogt@example.com' });
  });
});
