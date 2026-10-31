import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { boardPreferencesSchema } from '@wally/shared';
import {
  addTestMember,
  buildTestApp,
  createBoardFixture,
  resetDatabase,
  type TestContext,
} from './helpers.js';
import { notes, subtasks } from '../src/lib/postgres/schema/index.js';

let ctx: TestContext;
let fx: Awaited<ReturnType<typeof createBoardFixture>>;

beforeAll(async () => {
  ctx = await buildTestApp();
});
beforeEach(async () => {
  await resetDatabase(ctx.db);
  fx = await createBoardFixture(ctx);
});
afterAll(async () => {
  await ctx.app.close();
});

const as = (token: string) => ctx.authHeader(token);
type Row = { id: string; visibility: string; assignee: { id: string } | null; tags: string[] };

async function createNote(token: string, payload: Record<string, unknown> = {}) {
  return ctx.inject({
    method: 'POST',
    url: `/whiteboards/${fx.boardId}/notes`,
    headers: as(token),
    payload: { title: 'Ask Anna about Müller', ...payload },
  });
}
async function list(token: string, query = ''): Promise<Row[]> {
  const res = await ctx.inject({
    method: 'GET',
    url: `/whiteboards/${fx.boardId}/notes${query}`,
    headers: as(token),
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}
async function storedNote(noteId: string) {
  const [note] = await ctx.db.select().from(notes).where(eq(notes.id, noteId));
  return note;
}
async function storedSubtask(subtaskId: string) {
  const [subtask] = await ctx.db.select().from(subtasks).where(eq(subtasks.id, subtaskId));
  return subtask;
}
async function updateNote(noteId: string, values: Partial<typeof notes.$inferInsert>) {
  await ctx.db.update(notes).set(values).where(eq(notes.id, noteId));
}
/** Marks a note private straight in the database, so read tests do not depend on writes. */
async function makePrivate(noteId: string, creatorId: string) {
  await updateNote(noteId, { visibility: 'PRIVATE', assigneeId: creatorId });
}

describe('private notes: reads', () => {
  it('shows a private note only to its creator', async () => {
    const note = (await createNote(fx.editToken)).json();
    await makePrivate(note.id, fx.editorId);

    expect((await list(fx.editToken)).map((n) => [n.id, n.visibility])).toEqual([
      [note.id, 'PRIVATE'],
    ]);
    expect(await list(fx.ownerToken)).toEqual([]);
    expect(await list(fx.viewToken)).toEqual([]);

    const read = (token: string) =>
      ctx.inject({ method: 'GET', url: `/notes/${note.id}`, headers: as(token) });
    expect((await read(fx.editToken)).statusCode).toBe(200);
    expect((await read(fx.ownerToken)).statusCode).toBe(404);
  });

  it('never reveals another person’s private note through search, tags or properties', async () => {
    const note = (
      await createNote(fx.editToken, { tags: ['secret'], customFields: { Customer: 'Müller' } })
    ).json();
    await makePrivate(note.id, fx.editorId);

    const tags = await ctx.inject({
      method: 'GET',
      url: `/whiteboards/${fx.boardId}/tags`,
      headers: as(fx.ownerToken),
    });
    expect(tags.json()).toEqual([]);
    expect(await list(fx.ownerToken, '?q=secret')).toEqual([]);
    expect(await list(fx.ownerToken, '?field=Customer')).toEqual([]);
    expect((await list(fx.editToken, '?q=secret')).map((n) => n.id)).toEqual([note.id]);
  });

  it('filters by visibility', async () => {
    const mine = (await createNote(fx.editToken, { title: 'Private' })).json();
    const shared = (await createNote(fx.editToken, { title: 'For everyone' })).json();
    await makePrivate(mine.id, fx.editorId);

    expect((await list(fx.editToken, '?visibility=PRIVATE')).map((n) => n.id)).toEqual([mine.id]);
    expect((await list(fx.editToken, '?visibility=SHARED')).map((n) => n.id)).toEqual([shared.id]);
  });

  it('answers 404 to every command on someone else’s private note', async () => {
    const note = (await createNote(fx.editToken)).json();
    await makePrivate(note.id, fx.editorId);
    const owner = as(fx.ownerToken);
    const calls = [
      { method: 'PATCH' as const, url: `/notes/${note.id}`, payload: { title: 'x' } },
      { method: 'POST' as const, url: `/notes/${note.id}/complete`, payload: {} },
      { method: 'POST' as const, url: `/notes/${note.id}/duplicate`, payload: {} },
      { method: 'POST' as const, url: `/notes/${note.id}/subtasks`, payload: { text: 'x' } },
      { method: 'DELETE' as const, url: `/notes/${note.id}` },
    ];
    // The viewer loop proves the 404 comes before the role check (which would be 403).
    for (const headers of [owner, as(fx.viewToken)])
      for (const call of calls)
        expect((await ctx.inject({ ...call, headers })).statusCode, call.url).toBe(404);
    expect((await storedNote(note.id))!.title).toBe('Ask Anna about Müller');
    expect(await ctx.db.$count(subtasks, eq(subtasks.noteId, note.id))).toBe(0);
  });

  it('reads stored board preferences without a visibility as "all"', () => {
    const stored = { view: 'wall', axis: 'horizon', done: true, mine: false, priority: [] };
    expect(boardPreferencesSchema.parse(stored).visibility).toBe('all');
  });
});

async function expectInvariant(noteId: string) {
  const doc = await storedNote(noteId);
  if (doc?.visibility === 'PRIVATE') {
    expect(doc.createdById).not.toBeNull();
    expect(doc.assigneeId).toBe(doc.createdById);
  }
}
const patch = (token: string, noteId: string, payload: Record<string, unknown>) =>
  ctx.inject({ method: 'PATCH', url: `/notes/${noteId}`, headers: as(token), payload });

describe('private notes: writes', () => {
  it('creates a private note assigned to its creator', async () => {
    const res = await createNote(fx.editToken, { visibility: 'PRIVATE' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ visibility: 'PRIVATE', assignee: { id: fx.editorId } });
    await expectInvariant(res.json().id);
  });

  it('refuses a private note assigned to anyone else', async () => {
    const other = await createNote(fx.editToken, { visibility: 'PRIVATE', assigneeId: fx.ownerId });
    expect(other.statusCode).toBe(422);
    expect(other.json().error).toBe('PRIVATE_NOTE_NOT_ASSIGNABLE');
    const self = await createNote(fx.editToken, { visibility: 'PRIVATE', assigneeId: fx.editorId });
    expect(self.statusCode).toBe(201);
  });

  it('lets a viewer create and work on private notes, and only private ones', async () => {
    expect((await createNote(fx.viewToken)).statusCode).toBe(403);
    const note = (await createNote(fx.viewToken, { visibility: 'PRIVATE' })).json();
    const v = as(fx.viewToken);
    expect((await patch(fx.viewToken, note.id, { title: 'New' })).statusCode).toBe(200);
    for (const call of [
      {
        method: 'POST' as const,
        url: `/notes/${note.id}/move`,
        payload: { mode: 'HORIZON', horizon: 'LATER' },
      },
      { method: 'POST' as const, url: `/notes/${note.id}/complete`, payload: {} },
      { method: 'POST' as const, url: `/notes/${note.id}/reopen`, payload: {} },
      { method: 'POST' as const, url: `/notes/${note.id}/subtasks`, payload: { text: 'Call' } },
    ])
      expect((await ctx.inject({ ...call, headers: v })).statusCode, call.url).toBeLessThan(300);
    const copy = await ctx.inject({
      method: 'POST',
      url: `/notes/${note.id}/duplicate`,
      headers: v,
      payload: {},
    });
    expect(copy.statusCode).toBe(201);
    expect(copy.json()).toMatchObject({ visibility: 'PRIVATE', assignee: { id: fx.viewerId } });
    expect(
      (await ctx.inject({ method: 'DELETE', url: `/notes/${note.id}`, headers: v })).statusCode,
    ).toBe(204);
  });

  it('lets a viewer update and delete subtasks on their own private note only', async () => {
    const note = (await createNote(fx.viewToken, { visibility: 'PRIVATE' })).json();
    const sub = (path = '') => `/notes/${note.id}/subtasks${path}`;
    const added = await ctx.inject({
      method: 'POST',
      url: sub(),
      headers: as(fx.viewToken),
      payload: { text: 'Call' },
    });
    expect(added.statusCode).toBe(201);
    const subtaskId = added.json().id;
    const stored = () => storedSubtask(subtaskId);

    const done = await ctx.inject({
      method: 'PATCH',
      url: sub(`/${subtaskId}`),
      headers: as(fx.viewToken),
      payload: { done: true },
    });
    expect(done.statusCode).toBe(200);
    expect(await stored()).toMatchObject({ done: true, text: 'Call' });
    const edited = await ctx.inject({
      method: 'PATCH',
      url: sub(`/${subtaskId}`),
      headers: as(fx.viewToken),
      payload: { text: 'Call back' },
    });
    expect(edited.statusCode).toBe(200);
    expect(await stored()).toMatchObject({ done: true, text: 'Call back' });
    const removed = await ctx.inject({
      method: 'DELETE',
      url: sub(`/${subtaskId}`),
      headers: as(fx.viewToken),
    });
    expect(removed.statusCode).toBe(204);
    expect(await stored()).toBeUndefined();

    // The same viewer has no such right on a shared note's subtask.
    const shared = (await createNote(fx.ownerToken)).json();
    const sharedSub = (
      await ctx.inject({
        method: 'POST',
        url: `/notes/${shared.id}/subtasks`,
        headers: as(fx.ownerToken),
        payload: { text: 'For everyone' },
      })
    ).json();
    const refused = await ctx.inject({
      method: 'PATCH',
      url: `/notes/${shared.id}/subtasks/${sharedSub.id}`,
      headers: as(fx.viewToken),
      payload: { done: true },
    });
    expect(refused.statusCode).toBe(403);
    expect((await storedSubtask(sharedSub.id))!.done).toBe(false);
    const refusedDelete = await ctx.inject({
      method: 'DELETE',
      url: `/notes/${shared.id}/subtasks/${sharedSub.id}`,
      headers: as(fx.viewToken),
    });
    expect(refusedDelete.statusCode).toBe(403);
    expect(await storedSubtask(sharedSub.id)).toBeDefined();
  });

  it('never lets a viewer change who sees a note', async () => {
    const own = (await createNote(fx.viewToken, { visibility: 'PRIVATE' })).json();
    expect((await patch(fx.viewToken, own.id, { visibility: 'SHARED' })).statusCode).toBe(403);
    // A shared note the viewer created back when they had EDIT.
    const shared = (await createNote(fx.ownerToken)).json();
    await updateNote(shared.id, { createdById: fx.viewerId });
    expect((await patch(fx.viewToken, shared.id, { visibility: 'PRIVATE' })).statusCode).toBe(403);
    expect((await list(fx.ownerToken)).map((n) => n.id)).toEqual([shared.id]);
  });

  it('lets the creator switch a note private and back', async () => {
    const note = (await createNote(fx.editToken, { assigneeId: fx.ownerId })).json();
    const priv = await patch(fx.editToken, note.id, { visibility: 'PRIVATE' });
    expect(priv.json()).toMatchObject({
      visibility: 'PRIVATE',
      assignee: { id: fx.editorId },
      revision: 2,
    });
    await expectInvariant(note.id);
    expect(await list(fx.ownerToken)).toEqual([]);

    const back = await patch(fx.editToken, note.id, { visibility: 'SHARED' });
    expect(back.json()).toMatchObject({ visibility: 'SHARED', assignee: { id: fx.editorId } });
    expect((await list(fx.ownerToken)).map((n) => n.id)).toEqual([note.id]);
  });

  it('lets nobody but the creator change visibility', async () => {
    const note = (await createNote(fx.editToken)).json();
    expect((await patch(fx.ownerToken, note.id, { visibility: 'PRIVATE' })).statusCode).toBe(403);
    await updateNote(note.id, { createdById: null });
    expect((await patch(fx.editToken, note.id, { visibility: 'PRIVATE' })).statusCode).toBe(403);
  });

  it('keeps a private note assigned to its creator', async () => {
    const note = (await createNote(fx.editToken, { visibility: 'PRIVATE' })).json();
    const assign = (assigneeId: string | null) =>
      ctx.inject({
        method: 'POST',
        url: `/notes/${note.id}/assign`,
        headers: as(fx.editToken),
        payload: { assigneeId },
      });
    expect((await assign(fx.ownerId)).statusCode).toBe(422);
    expect((await assign(null)).statusCode).toBe(422);
    expect((await assign(fx.editorId)).statusCode).toBe(200);
    await expectInvariant(note.id);
  });

  it('copies keep the source visibility', async () => {
    const shared = (await createNote(fx.editToken)).json();
    const copy = await ctx.inject({
      method: 'POST',
      url: `/notes/${shared.id}/duplicate`,
      headers: as(fx.editToken),
      payload: {},
    });
    expect(copy.json().visibility).toBe('SHARED');
  });

  it('replays a viewer’s retried private write instead of refusing it', async () => {
    const key = randomUUID();
    const send = () =>
      ctx.app.inject({
        method: 'POST',
        url: `/whiteboards/${fx.boardId}/notes`,
        headers: { ...as(fx.viewToken), 'idempotency-key': key },
        payload: { title: 'Just for me', visibility: 'PRIVATE' },
      });
    const first = await send();
    expect(first.statusCode).toBe(201);
    const second = await send();
    expect(second.statusCode).toBe(201);
    expect(second.json().id).toBe(first.json().id);

    const editKey = randomUUID();
    const edit = () =>
      ctx.app.inject({
        method: 'PATCH',
        url: `/notes/${first.json().id}`,
        headers: { ...as(fx.viewToken), 'idempotency-key': editKey, 'x-expected-revision': '1' },
        payload: { title: 'Changed' },
      });
    expect((await edit()).statusCode).toBe(200);
    expect((await edit()).statusCode).toBe(200);
  });
});

describe('private notes: replay after a role change', () => {
  const demote = () =>
    ctx.inject({
      method: 'PATCH',
      url: `/whiteboards/${fx.boardId}/members/${fx.editMemberId}`,
      headers: as(fx.ownerToken),
      payload: { role: 'VIEW' },
    });

  it('refuses to replay a shared write once its author was demoted to viewer', async () => {
    const shared = (await createNote(fx.ownerToken)).json();
    const key = randomUUID();
    const edit = () =>
      ctx.app.inject({
        method: 'PATCH',
        url: `/notes/${shared.id}`,
        headers: { ...as(fx.editToken), 'idempotency-key': key, 'x-expected-revision': '1' },
        payload: { title: 'From the editor' },
      });
    expect((await edit()).statusCode).toBe(200);

    const demoted = await demote();
    expect(demoted.statusCode).toBe(200);
    expect(demoted.json().role).toBe('VIEW');
    const before = (await storedNote(shared.id))!;
    // Replaying with the same key would otherwise return the stored 200; the role is re-checked.
    expect((await edit()).statusCode).toBe(403);
    const after = (await storedNote(shared.id))!;
    expect(after.title).toBe('From the editor');
    expect(after.revision).toBe(before.revision);
  });

  it('still replays a private create after its author was demoted to viewer', async () => {
    const key = randomUUID();
    const send = () =>
      ctx.app.inject({
        method: 'POST',
        url: `/whiteboards/${fx.boardId}/notes`,
        headers: { ...as(fx.editToken), 'idempotency-key': key },
        payload: { title: 'Just for me', visibility: 'PRIVATE' },
      });
    const first = await send();
    expect(first.statusCode).toBe(201);

    expect((await demote()).statusCode).toBe(200);
    const second = await send();
    expect(second.statusCode).toBe(201);
    expect(second.json().id).toBe(first.json().id);
    expect((await list(fx.editToken, '?visibility=PRIVATE')).map((n) => n.id)).toEqual([
      first.json().id,
    ]);
  });
});

describe('private notes: leaving the board', () => {
  it('keeps a removed member’s private notes hidden and returns them on rejoin', async () => {
    const priv = (await createNote(fx.editToken, { visibility: 'PRIVATE' })).json();
    const shared = (await createNote(fx.editToken, { assigneeId: fx.editorId })).json();

    const removed = await ctx.inject({
      method: 'DELETE',
      url: `/whiteboards/${fx.boardId}/members/${fx.editMemberId}`,
      headers: as(fx.ownerToken),
    });
    expect(removed.statusCode).toBe(204);

    const privDoc = (await storedNote(priv.id))!;
    expect(privDoc.assigneeId).toBe(fx.editorId);
    expect(privDoc.revision).toBe(priv.revision);
    expect((await storedNote(shared.id))!.assigneeId).toBeNull();
    expect((await list(fx.ownerToken)).map((n) => n.id)).toEqual([shared.id]);

    await addTestMember(ctx.db, fx.boardId, fx.editorId, 'VIEW');
    expect((await list(fx.editToken, '?visibility=PRIVATE')).map((n) => n.id)).toEqual([priv.id]);
  });
});
