import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_OWN_BOARDS } from '@wally/shared';
import { eq, inArray } from 'drizzle-orm';
import { drainCleanup } from '../src/lib/commands/maintenance.js';
import { liveBoard } from '../src/lib/db/records.js';
import {
  boardCleanup,
  boardMembers,
  notes,
  shareLinks,
  subtasks,
  whiteboards,
} from '../src/lib/postgres/schema/index.js';
import { buildTestApp, createBoardFixture, resetDatabase, type TestContext } from './helpers.js';

/** RFC 0002 §8–§10, §12: creating, deleting and leaving boards. */
let ctx: TestContext;
let fx: Awaited<ReturnType<typeof createBoardFixture>>;

beforeAll(async () => {
  ctx = await buildTestApp();
});
beforeEach(async () => {
  await resetDatabase(ctx.db);
  fx = await createBoardFixture(ctx);
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await ctx.app.close();
});

const loadBoard = async (id: string) =>
  (await ctx.db.select().from(whiteboards).where(eq(whiteboards.id, id)))[0];
const loadNote = async (id: string) =>
  (await ctx.db.select().from(notes).where(eq(notes.id, id)))[0];
const subtaskCount = (noteIds: string[]) =>
  ctx.db.$count(subtasks, inArray(subtasks.noteId, noteIds));

/**
 * Fails the cleanup that runs after board.delete commits: the command's own transaction
 * goes through, the next one (the inline cleanup job) is interrupted.
 */
function interruptCleanup() {
  const original = ctx.db.transaction.bind(ctx.db);
  vi.spyOn(ctx.db, 'transaction')
    .mockImplementationOnce(original)
    .mockRejectedValueOnce(new Error('interrupted'));
}

const create = (token: string, name = 'Project North', key = randomUUID()) =>
  ctx.app.inject({
    method: 'POST',
    url: '/whiteboards',
    headers: { ...ctx.authHeader(token), 'idempotency-key': key },
    payload: { name },
  });

const listIds = async (token: string) =>
  (
    await ctx.inject({ method: 'GET', url: '/whiteboards', headers: ctx.authHeader(token) })
  ).json() as { id: string; name: string; currentUserRole: string }[];

describe('board.create', () => {
  it('creates a second own board with a generated id and lists it as OWNER', async () => {
    const res = await create(fx.ownerToken);
    expect(res.statusCode).toBe(201);
    const dto = res.json();
    expect(dto).toMatchObject({
      name: 'Project North',
      ownerId: fx.ownerId,
      currentUserRole: 'OWNER',
      revision: 1,
    });
    expect(dto.id).not.toBe(fx.ownerId);
    expect(res.headers['x-resource-revision']).toBe('1');
    expect(await listIds(fx.ownerToken)).toEqual(
      expect.arrayContaining([{ id: dto.id, name: 'Project North', currentUserRole: 'OWNER' }]),
    );
  });

  it('replays the same operation id instead of creating twice', async () => {
    const key = randomUUID();
    const first = await create(fx.ownerToken, 'Once', key);
    const second = await create(fx.ownerToken, 'Once', key);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect((await create(fx.ownerToken, 'Different', key)).statusCode).toBe(409);
    expect((await listIds(fx.ownerToken)).filter((b) => b.name === 'Once')).toHaveLength(1);
  });

  it('refuses a blank name and a missing operation id', async () => {
    expect((await create(fx.ownerToken, '   ')).statusCode).toBe(400);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/whiteboards',
      headers: ctx.authHeader(fx.ownerToken),
      payload: { name: 'x' },
    });
    expect(res.statusCode).toBe(428);
  });

  it('stops at MAX_OWN_BOARDS live boards', async () => {
    // The fixture owner already owns their provisioned board.
    for (let i = 1; i < MAX_OWN_BOARDS; i++)
      expect((await create(fx.ownerToken, `Board ${i}`)).statusCode).toBe(201);
    const over = await create(fx.ownerToken, 'One too many');
    expect(over.statusCode).toBe(422);
    expect(over.json().error).toBe('BOARD_LIMIT_REACHED');
  });
});

const del = (token: string, boardId: string, key = randomUUID()) =>
  ctx.inject({
    method: 'DELETE',
    url: `/whiteboards/${boardId}`,
    headers: { ...ctx.authHeader(token), 'idempotency-key': key },
  });

describe('board.delete', () => {
  it('is for the owner only', async () => {
    expect((await del(fx.editToken, fx.boardId)).statusCode).toBe(403);
    expect((await del(fx.outsiderToken, fx.boardId)).statusCode).toBe(404);
  });

  it('hides the board at once and finishes the physical deletion in cleanup', async () => {
    const owner = ctx.authHeader(fx.ownerToken);
    const note = (
      await ctx.inject({
        method: 'POST',
        url: `/whiteboards/${fx.boardId}/notes`,
        headers: owner,
        payload: { title: 'Away with it' },
      })
    ).json();
    await ctx.inject({
      method: 'POST',
      url: `/notes/${note.id}/subtasks`,
      headers: owner,
      payload: { text: 'Part' },
    });
    await ctx.inject({
      method: 'POST',
      url: `/whiteboards/${fx.boardId}/share-link`,
      headers: owner,
      payload: { role: 'VIEW' },
    });
    const [link] = await ctx.db.select().from(shareLinks).where(eq(shareLinks.boardId, fx.boardId));
    expect(link?.token).toBeTruthy();

    expect((await del(fx.ownerToken, fx.boardId)).statusCode).toBe(204);

    for (const t of [fx.ownerToken, fx.editToken]) {
      expect((await listIds(t)).map((b) => b.id)).not.toContain(fx.boardId);
      const get = await ctx.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}`,
        headers: ctx.authHeader(t),
      });
      expect(get.statusCode).toBe(404);
    }
    expect(await ctx.db.$count(shareLinks, eq(shareLinks.token, link!.token))).toBe(0);
    // Cleanup ran inline after the commit; nothing is left for maintenance.
    expect(await drainCleanup(ctx.db)).toEqual({ completed: 0, pending: 0 });
    expect(await loadNote(note.id)).toBeUndefined();
    expect(await subtaskCount([note.id])).toBe(0);
    expect(await ctx.db.$count(boardMembers, eq(boardMembers.boardId, fx.boardId))).toBe(0);
    expect(await loadBoard(fx.boardId)).toBeUndefined();
  });

  it('keeps the job and the tombstone when cleanup fails, and a later drain finishes it', async () => {
    interruptCleanup();
    expect((await del(fx.ownerToken, fx.boardId)).statusCode).toBe(204);
    expect(await ctx.db.$count(boardCleanup)).toBe(1);
    expect((await loadBoard(fx.boardId))?.deletedAt).toBeTruthy();
    expect((await listIds(fx.ownerToken)).map((b) => b.id)).not.toContain(fx.boardId);
    expect(await drainCleanup(ctx.db)).toEqual({ completed: 1, pending: 0 });
    expect(await loadBoard(fx.boardId)).toBeUndefined();
  });

  it('deletes a board with many notes, and a rerun finishes what a failure left', async () => {
    const owner = ctx.authHeader(fx.ownerToken);
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      const note = (
        await ctx.inject({
          method: 'POST',
          url: `/whiteboards/${fx.boardId}/notes`,
          headers: owner,
          payload: { title: `Note ${i}` },
        })
      ).json();
      ids.push(note.id);
      if (i % 3 === 0)
        await ctx.inject({
          method: 'POST',
          url: `/notes/${note.id}/subtasks`,
          headers: owner,
          payload: { text: 'Part' },
        });
    }
    // The cleanup fails; the tombstoned board and its notes wait for the next drain.
    interruptCleanup();
    expect((await del(fx.ownerToken, fx.boardId)).statusCode).toBe(204);
    expect(await ctx.db.$count(boardCleanup)).toBe(1);
    expect(await loadBoard(fx.boardId)).toBeDefined();

    expect(await drainCleanup(ctx.db)).toEqual({ completed: 1, pending: 0 });
    expect(await ctx.db.$count(notes, eq(notes.boardId, fx.boardId))).toBe(0);
    expect(await subtaskCount(ids)).toBe(0);
    expect(await loadBoard(fx.boardId)).toBeUndefined();
  });

  it('refuses a stale revision and answers a retry after completion with 404', async () => {
    const key = randomUUID();
    await ctx.inject({
      method: 'PATCH',
      url: `/whiteboards/${fx.boardId}`,
      headers: ctx.authHeader(fx.ownerToken),
      payload: { name: 'Renamed' },
    });
    const stale = await ctx.app.inject({
      method: 'DELETE',
      url: `/whiteboards/${fx.boardId}`,
      headers: {
        ...ctx.authHeader(fx.ownerToken),
        'idempotency-key': key,
        'x-expected-revision': '0',
      },
    });
    expect(stale.statusCode).toBe(409);
    expect((await del(fx.ownerToken, fx.boardId, key)).statusCode).toBe(204);
    // The receipt exists, but re-authorization against a board that now reads as absent fails.
    expect((await del(fx.ownerToken, fx.boardId, key)).statusCode).toBe(404);
  });

  it('frees a slot under MAX_OWN_BOARDS', async () => {
    for (let i = 1; i < MAX_OWN_BOARDS; i++)
      expect((await create(fx.ownerToken, `Board ${i}`)).statusCode).toBe(201);
    expect((await create(fx.ownerToken, 'Too many')).statusCode).toBe(422);
    expect((await del(fx.ownerToken, fx.boardId)).statusCode).toBe(204);
    expect((await create(fx.ownerToken, 'Fits again')).statusCode).toBe(201);
  });
});

const leave = (token: string, boardId: string, key = randomUUID()) =>
  ctx.app.inject({
    method: 'POST',
    url: `/whiteboards/${boardId}/leave`,
    headers: { ...ctx.authHeader(token), 'idempotency-key': key },
    payload: {},
  });

describe('board.leave', () => {
  it('lets a member leave without an expected revision, and clears their assignments', async () => {
    const owner = ctx.authHeader(fx.ownerToken);
    const note = (
      await ctx.inject({
        method: 'POST',
        url: `/whiteboards/${fx.boardId}/notes`,
        headers: owner,
        payload: { title: 'For the editor' },
      })
    ).json();
    const assigned = await ctx.inject({
      method: 'POST',
      url: `/notes/${note.id}/assign`,
      headers: owner,
      payload: { assigneeId: fx.editorId },
    });
    expect(assigned.statusCode).toBe(200);

    expect((await leave(fx.editToken, fx.boardId)).statusCode).toBe(204);

    expect((await listIds(fx.editToken)).map((b) => b.id)).not.toContain(fx.boardId);
    const get = await ctx.inject({
      method: 'GET',
      url: `/whiteboards/${fx.boardId}`,
      headers: ctx.authHeader(fx.editToken),
    });
    expect(get.statusCode).toBe(404);
    const members = (
      await ctx.inject({ method: 'GET', url: `/whiteboards/${fx.boardId}/members`, headers: owner })
    ).json() as { userId: string | null }[];
    expect(members.some((m) => m.userId === fx.editorId)).toBe(false);
    expect((await loadNote(note.id))?.assigneeId).toBeNull();
    const board = await liveBoard(ctx.db, fx.boardId);
    expect(board?.memberRoles[fx.editorId]).toBeUndefined();
  });

  it('is refused for the owner and unknown for an outsider', async () => {
    expect((await leave(fx.ownerToken, fx.boardId)).statusCode).toBe(403);
    expect((await leave(fx.outsiderToken, fx.boardId)).statusCode).toBe(404);
  });

  it('answers a retry after leaving with 404', async () => {
    const key = randomUUID();
    expect((await leave(fx.viewToken, fx.boardId, key)).statusCode).toBe(204);
    expect((await leave(fx.viewToken, fx.boardId, key)).statusCode).toBe(404);
  });
});
