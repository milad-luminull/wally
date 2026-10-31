import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import {
  boardMembers,
  notes,
  shareLinks,
  subtasks,
  users,
  whiteboards,
} from '../postgres/schema/index.js';
import { newId } from './ids.js';
import { anyBoard, liveBoard, loadNote, loadUsers } from './records.js';

const at = new Date('2026-10-31T09:00:00.000Z');

const user = (id: string) => ({
  id,
  email: `${id}@example.com`,
  emailVerified: true,
  language: 'en' as const,
  createdAt: at,
  updatedAt: at,
});

describe('records', () => {
  let handle: TestDatabase;

  beforeAll(async () => {
    handle = await createTestDatabase();
  });

  afterAll(async () => {
    await handle?.drop();
  });

  beforeEach(async () => {
    const { db } = handle;
    await db.execute(sql`truncate users, whiteboards cascade`);
    await db.insert(users).values([user('owner'), user('editor'), user('invitee')]);
    await db
      .insert(whiteboards)
      .values({ id: 'b1', ownerId: 'owner', name: 'Launch', createdAt: at, updatedAt: at });
  });

  it('loads a board with the roles of its active members and its share link token', async () => {
    const { db } = handle;
    await db.insert(boardMembers).values([
      {
        id: 'm1',
        boardId: 'b1',
        userId: 'editor',
        role: 'EDIT',
        status: 'ACTIVE',
        invitedAt: at,
        activatedAt: at,
      },
      {
        id: 'm2',
        boardId: 'b1',
        userId: 'invitee',
        role: 'VIEW',
        status: 'PENDING',
        invitedAt: at,
      },
      {
        id: 'm3',
        boardId: 'b1',
        invitedEmail: 'later@example.com',
        role: 'VIEW',
        status: 'ACTIVE',
        invitedAt: at,
      },
    ]);
    await db
      .insert(shareLinks)
      .values({ token: 't1', boardId: 'b1', role: 'VIEW', createdAt: at, updatedAt: at });

    const board = await liveBoard(db, 'b1');

    expect(board).toMatchObject({
      id: 'b1',
      ownerId: 'owner',
      revision: 1,
      memberRoles: { editor: 'EDIT' },
      shareLinkToken: 't1',
    });
    expect(board!.createdAt).toEqual(at);
  });

  it('gives a board without members or link empty roles and a null token', async () => {
    const board = await liveBoard(handle.db, 'b1');
    expect(board).toMatchObject({ memberRoles: {}, shareLinkToken: null });
  });

  it('reads a tombstoned board as missing, except to the cleanup job', async () => {
    await handle.db.update(whiteboards).set({ deletedAt: at });
    expect(await liveBoard(handle.db, 'b1')).toBeNull();
    expect(await anyBoard(handle.db, 'b1')).toMatchObject({ id: 'b1', deletedAt: at });
    expect(await liveBoard(handle.db, 'missing')).toBeNull();
  });

  it('loads a note with its subtask counts', async () => {
    const { db } = handle;
    await db.insert(notes).values({
      id: 'n1',
      boardId: 'b1',
      title: 'Book the venue',
      status: 'OPEN',
      priority: 'MEDIUM',
      horizon: 'THIS_WEEK',
      freeX: 0,
      freeY: 0,
      colour: 'CHALK',
      createdById: 'owner',
      createdAt: at,
      updatedAt: at,
    });
    expect((await loadNote(db, 'n1'))!.subtaskSummary).toEqual({ total: 0, done: 0 });

    await db.insert(subtasks).values(
      [true, false, true].map((done, sortIndex) => ({
        id: `s${sortIndex}`,
        noteId: 'n1',
        text: 'Step',
        done,
        sortIndex,
        createdAt: at,
        updatedAt: at,
      })),
    );
    const note = await loadNote(db, 'n1');
    expect(note).toMatchObject({ id: 'n1', boardId: 'b1', subtaskSummary: { total: 3, done: 2 } });
    expect(await loadNote(db, 'missing')).toBeNull();
  });

  it('loads users by id, skipping nulls, duplicates and unknown ids', async () => {
    const found = await loadUsers(handle.db, ['owner', null, 'owner', undefined, 'nobody']);
    expect([...found.keys()]).toEqual(['owner']);
    expect(found.get('owner')!.email).toBe('owner@example.com');
    expect((await loadUsers(handle.db, [])).size).toBe(0);
  });
});

describe('newId', () => {
  it('is 20 alphanumeric characters, like a Firestore auto-id', () => {
    const ids = Array.from({ length: 200 }, newId);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9]{20}$/);
    expect(new Set(ids).size).toBe(200);
  });
});
