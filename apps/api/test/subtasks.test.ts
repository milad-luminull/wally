import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { subtasksCol, withId } from '../src/lib/db/collections.js';
import { buildTestApp, createBoardFixture, resetDatabase, type TestContext } from './helpers.js';

const PROJECT_ID = 'wally-test-subtasks';

describe('subtask routes', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await buildTestApp(PROJECT_ID);
  });

  afterEach(async () => {
    await resetDatabase(PROJECT_ID);
  });

  afterAll(async () => {
    await resetDatabase(PROJECT_ID);
    await ctx.app.close();
  });

  async function setup() {
    const fx = await createBoardFixture(ctx);
    const created = await ctx.inject({
      method: 'POST',
      url: `/whiteboards/${fx.boardId}/notes`,
      headers: ctx.authHeader(fx.ownerToken),
      payload: { title: 'With subtasks' },
    });
    return { fx, noteId: created.json().id as string };
  }

  const summaryOf = async (fx: { boardId: string; ownerToken: string }, noteId: string) => {
    const detail = await ctx.inject({
      method: 'GET',
      url: `/notes/${noteId}`,
      headers: ctx.authHeader(fx.ownerToken),
    });
    return detail.json().subtaskSummary;
  };

  it('POST creates a subtask for EDIT/OWNER, 403 for VIEW, 404 for non-member', async () => {
    const { fx, noteId } = await setup();

    const ok = await ctx.inject({
      method: 'POST',
      url: `/notes/${noteId}/subtasks`,
      headers: ctx.authHeader(fx.editToken),
      payload: { text: 'First task' },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().done).toBe(false);

    const forbidden = await ctx.inject({
      method: 'POST',
      url: `/notes/${noteId}/subtasks`,
      headers: ctx.authHeader(fx.viewToken),
      payload: { text: 'Nope' },
    });
    expect(forbidden.statusCode).toBe(403);

    const notFound = await ctx.inject({
      method: 'POST',
      url: `/notes/${noteId}/subtasks`,
      headers: ctx.authHeader(fx.outsiderToken),
      payload: { text: 'Nope' },
    });
    expect(notFound.statusCode).toBe(404);
  });

  it('PATCH toggles done, DELETE removes it', async () => {
    const { fx, noteId } = await setup();
    const created = await ctx.inject({
      method: 'POST',
      url: `/notes/${noteId}/subtasks`,
      headers: ctx.authHeader(fx.ownerToken),
      payload: { text: 'Check' },
    });
    const subtaskId = created.json().id;

    const patched = await ctx.inject({
      method: 'PATCH',
      url: `/notes/${noteId}/subtasks/${subtaskId}`,
      headers: ctx.authHeader(fx.ownerToken),
      payload: { done: true },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().done).toBe(true);

    const deleted = await ctx.inject({
      method: 'DELETE',
      url: `/notes/${noteId}/subtasks/${subtaskId}`,
      headers: ctx.authHeader(fx.ownerToken),
    });
    expect(deleted.statusCode).toBe(204);

    const gone = withId(await subtasksCol(ctx.db, noteId).doc(subtaskId).get());
    expect(gone).toBeNull();
  });

  it("keeps the note's subtask counter correct, including repeated done:true", async () => {
    // The counter on the note is denormalized and moved by increments, so a PATCH that
    // does not actually change `done` must not move it — the schema allows done:true on
    // an already-done subtask.
    const { fx, noteId } = await setup();
    const created = await ctx.inject({
      method: 'POST',
      url: `/notes/${noteId}/subtasks`,
      headers: ctx.authHeader(fx.ownerToken),
      payload: { text: 'Tick once' },
    });
    const subtaskId = created.json().id;
    expect(await summaryOf(fx, noteId)).toEqual({ total: 1, done: 0 });

    for (let i = 0; i < 3; i += 1) {
      await ctx.inject({
        method: 'PATCH',
        url: `/notes/${noteId}/subtasks/${subtaskId}`,
        headers: ctx.authHeader(fx.ownerToken),
        payload: { done: true },
      });
    }
    expect(await summaryOf(fx, noteId)).toEqual({ total: 1, done: 1 });

    await ctx.inject({
      method: 'PATCH',
      url: `/notes/${noteId}/subtasks/${subtaskId}`,
      headers: ctx.authHeader(fx.ownerToken),
      payload: { done: false },
    });
    expect(await summaryOf(fx, noteId)).toEqual({ total: 1, done: 0 });

    await ctx.inject({
      method: 'DELETE',
      url: `/notes/${noteId}/subtasks/${subtaskId}`,
      headers: ctx.authHeader(fx.ownerToken),
    });
    expect(await summaryOf(fx, noteId)).toEqual({ total: 0, done: 0 });
  });
});
