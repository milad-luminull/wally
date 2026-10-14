import { FieldValue } from 'firebase-admin/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { boardPreferencesSchema } from '@wally/shared';
import { buildTestApp, createBoardFixture, resetDatabase, type TestContext } from './helpers.js';
import { notesCol, subtasksCol } from '../src/lib/db/collections.js';

const projectId = 'wally-private-notes';
let ctx: TestContext;
let fx: Awaited<ReturnType<typeof createBoardFixture>>;

beforeAll(async () => {
  ctx = await buildTestApp(projectId);
});
beforeEach(async () => {
  await resetDatabase(projectId);
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
    payload: { title: 'Anna wegen Müller fragen', ...payload },
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
/** Marks a note private straight in the database, so read tests do not depend on writes. */
async function makePrivate(noteId: string, creatorId: string) {
  await notesCol(ctx.db).doc(noteId).update({ visibility: 'PRIVATE', assigneeId: creatorId });
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

  it('reads notes written before visibility existed as shared', async () => {
    const note = (await createNote(fx.ownerToken)).json();
    await notesCol(ctx.db).doc(note.id).update({ visibility: FieldValue.delete() });
    expect((await list(fx.viewToken))[0]!.visibility).toBe('SHARED');
  });

  it('never reveals another person’s private note through search, tags or properties', async () => {
    const note = (
      await createNote(fx.editToken, { tags: ['geheim'], customFields: { Kunde: 'Müller' } })
    ).json();
    await makePrivate(note.id, fx.editorId);

    const tags = await ctx.inject({
      method: 'GET',
      url: `/whiteboards/${fx.boardId}/tags`,
      headers: as(fx.ownerToken),
    });
    expect(tags.json()).toEqual([]);
    expect(await list(fx.ownerToken, '?q=geheim')).toEqual([]);
    expect(await list(fx.ownerToken, '?field=Kunde')).toEqual([]);
    expect((await list(fx.editToken, '?q=geheim')).map((n) => n.id)).toEqual([note.id]);
  });

  it('filters by visibility', async () => {
    const mine = (await createNote(fx.editToken, { title: 'Privat' })).json();
    const shared = (await createNote(fx.editToken, { title: 'Für alle' })).json();
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
    for (const call of calls)
      expect((await ctx.inject({ ...call, headers: owner })).statusCode, call.url).toBe(404);
    expect((await notesCol(ctx.db).doc(note.id).get()).data()!.title).toBe(
      'Anna wegen Müller fragen',
    );
    expect((await subtasksCol(ctx.db, note.id).get()).size).toBe(0);
  });

  it('reads stored board preferences without a visibility as "all"', () => {
    const stored = { view: 'wand', axis: 'horizon', done: true, mine: false, priority: [] };
    expect(boardPreferencesSchema.parse(stored).visibility).toBe('all');
  });
});
