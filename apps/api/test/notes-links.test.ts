import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { notesCol } from '../src/lib/db/collections.js';
import { buildTestApp, createBoardFixture, resetDatabase, type TestContext } from './helpers.js';

const PROJECT_ID = 'wally-test-notes-links';

describe('note links', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await buildTestApp(PROJECT_ID);
  });
  afterEach(() => resetDatabase(PROJECT_ID));
  afterAll(async () => {
    await resetDatabase(PROJECT_ID);
    await ctx.app.close();
  });

  const create = async (boardId: string, token: string, body: Record<string, unknown> = {}) =>
    (
      await ctx.inject({
        method: 'POST',
        url: `/whiteboards/${boardId}/notes`,
        headers: ctx.authHeader(token),
        payload: { title: 'Note', ...body },
      })
    ).json();
  const patch = (token: string, noteId: string, body: Record<string, unknown>) =>
    ctx.inject({
      method: 'PATCH',
      url: `/notes/${noteId}`,
      headers: ctx.authHeader(token),
      payload: body,
    });
  const stored = async (id: string) => (await notesCol(ctx.db).doc(id).get()).data()!;

  it('adds and removes links on the note’s current list and leaves the target alone', async () => {
    const fx = await createBoardFixture(ctx);
    const a = await create(fx.boardId, fx.ownerToken, { title: 'A' });
    const b = await create(fx.boardId, fx.ownerToken, { title: 'B' });
    const c = await create(fx.boardId, fx.editToken, { title: 'C' });
    let res = await patch(fx.ownerToken, a.id, { linkChanges: { add: [b.id, c.id, b.id] } });
    expect(res.statusCode).toBe(200);
    expect(res.json().links).toEqual([b.id, c.id]);
    expect((await stored(b.id)).revision).toBe(b.revision);
    res = await patch(fx.ownerToken, a.id, { linkChanges: { remove: [b.id, 'nope'] } });
    expect(res.json().links).toEqual([c.id]);
    const list = (
      await ctx.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}/notes`,
        headers: ctx.authHeader(fx.ownerToken),
      })
    ).json();
    expect(list.find((n: { id: string }) => n.id === a.id).links).toEqual([c.id]);
    expect(list.find((n: { id: string }) => n.id === b.id).links).toEqual([]);
    // Removing an id that is not there changes nothing, even on a note with no list yet.
    res = await patch(fx.ownerToken, b.id, { linkChanges: { remove: ['nope'] } });
    expect(res.statusCode).toBe(200);
    expect((await stored(b.id)).revision).toBe(b.revision);
    expect((await stored(b.id)).links).toBeUndefined();
  });

  it('refuses the note itself, a note elsewhere, a deleted note and another person’s private note', async () => {
    const fx = await createBoardFixture(ctx);
    const a = await create(fx.boardId, fx.ownerToken, { title: 'A' });
    const gone = await create(fx.boardId, fx.ownerToken, { title: 'Gone' });
    await ctx.inject({
      method: 'DELETE',
      url: `/notes/${gone.id}`,
      headers: ctx.authHeader(fx.ownerToken),
    });
    const secret = await create(fx.boardId, fx.editToken, {
      title: 'Secret',
      visibility: 'PRIVATE',
    });
    // Another board: the editor's own board (a board's id is its owner's uid).
    await ctx.inject({ method: 'GET', url: '/whiteboards', headers: ctx.authHeader(fx.editToken) });
    const elsewhere = await create(fx.editorId, fx.editToken, { title: 'Elsewhere' });
    for (const id of [a.id, gone.id, secret.id, elsewhere.id, 'missing-id']) {
      const res = await patch(fx.ownerToken, a.id, { linkChanges: { add: [id] } });
      expect(res.statusCode, id).toBe(422);
      expect(res.json().error).toBe('LINK_TARGET_INVALID');
    }
    expect((await stored(a.id)).links ?? []).toEqual([]);
    expect((await stored(a.id)).revision).toBe(a.revision);
  });

  it('filters link ids for each reader on lists, details and mutation responses', async () => {
    const fx = await createBoardFixture(ctx);
    const a = await create(fx.boardId, fx.ownerToken, { title: 'Source' });
    const visible = await create(fx.boardId, fx.ownerToken, { title: 'Visible' });
    const secret = await create(fx.boardId, fx.ownerToken, {
      title: 'Secret',
      visibility: 'PRIVATE',
    });
    const gone = await create(fx.boardId, fx.ownerToken, { title: 'Gone' });
    await notesCol(ctx.db)
      .doc(gone.id)
      .update({ deletedAt: (await stored(gone.id)).createdAt });
    await notesCol(ctx.db)
      .doc(a.id)
      .update({ links: [visible.id, secret.id, gone.id, 'missing'] });
    for (const token of [fx.editToken, fx.viewToken, fx.ownerToken]) {
      const expected = token === fx.ownerToken ? [visible.id, secret.id] : [visible.id];
      const list = await ctx.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}/notes?q=Source`,
        headers: ctx.authHeader(token),
      });
      expect(list.statusCode).toBe(200);
      expect(list.json()[0].links).toEqual(expected);
      const detail = await ctx.inject({
        method: 'GET',
        url: `/notes/${a.id}`,
        headers: ctx.authHeader(token),
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().links).toEqual(expected);
    }
    const updated = await patch(fx.editToken, a.id, { title: 'Changed' });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().links).toEqual([visible.id]);
    expect((await stored(a.id)).links).toEqual([visible.id, secret.id, gone.id, 'missing']);
  });

  it('caps the list at ten and keeps a viewer to their own private notes', async () => {
    const fx = await createBoardFixture(ctx);
    const a = await create(fx.boardId, fx.ownerToken, { title: 'A' });
    const ids: string[] = [];
    for (let i = 0; i < 11; i++)
      ids.push((await create(fx.boardId, fx.ownerToken, { title: `T${i}` })).id);
    expect(
      (await patch(fx.ownerToken, a.id, { linkChanges: { add: ids.slice(0, 10) } })).statusCode,
    ).toBe(200);
    expect(
      (await patch(fx.ownerToken, a.id, { linkChanges: { add: [ids[10]!] } })).statusCode,
    ).toBe(400);
    // A VIEW member may create only private notes (rolesFor), and edit only their own.
    const mine = await create(fx.boardId, fx.viewToken, { title: 'Mine', visibility: 'PRIVATE' });
    expect((await patch(fx.viewToken, mine.id, { linkChanges: { add: [a.id] } })).statusCode).toBe(
      200,
    );
    expect((await patch(fx.viewToken, a.id, { linkChanges: { add: [mine.id] } })).statusCode).toBe(
      403,
    );
  });
});
