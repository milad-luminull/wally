import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, createBoardFixture, resetDatabase, type TestContext } from './helpers.js';

describe('subtask routes', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await buildTestApp();
  });

  afterEach(async () => {
    await resetDatabase(ctx.prisma);
  });

  afterAll(async () => {
    await resetDatabase(ctx.prisma);
    await ctx.app.close();
  });

  async function setup() {
    const fx = await createBoardFixture(ctx);
    const note = await ctx.prisma.note.create({
      data: { whiteboardId: fx.boardId, title: 'Mit Subtasks' },
    });
    return { fx, noteId: note.id };
  }

  it('POST creates a subtask for EDIT/OWNER, 403 for VIEW, 404 for non-member', async () => {
    const { fx, noteId } = await setup();

    const ok = await ctx.app.inject({
      method: 'POST',
      url: `/notes/${noteId}/subtasks`,
      headers: ctx.authHeader(fx.editToken),
      payload: { text: 'Erste Aufgabe' },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().done).toBe(false);

    const forbidden = await ctx.app.inject({
      method: 'POST',
      url: `/notes/${noteId}/subtasks`,
      headers: ctx.authHeader(fx.viewToken),
      payload: { text: 'Nope' },
    });
    expect(forbidden.statusCode).toBe(403);

    const notFound = await ctx.app.inject({
      method: 'POST',
      url: `/notes/${noteId}/subtasks`,
      headers: ctx.authHeader(fx.outsiderToken),
      payload: { text: 'Nope' },
    });
    expect(notFound.statusCode).toBe(404);
  });

  it('PATCH toggles done, DELETE removes it', async () => {
    const { fx, noteId } = await setup();
    const created = await ctx.app.inject({
      method: 'POST',
      url: `/notes/${noteId}/subtasks`,
      headers: ctx.authHeader(fx.ownerToken),
      payload: { text: 'Checken' },
    });
    const subtaskId = created.json().id;

    const patched = await ctx.app.inject({
      method: 'PATCH',
      url: `/notes/${noteId}/subtasks/${subtaskId}`,
      headers: ctx.authHeader(fx.ownerToken),
      payload: { done: true },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().done).toBe(true);

    const deleted = await ctx.app.inject({
      method: 'DELETE',
      url: `/notes/${noteId}/subtasks/${subtaskId}`,
      headers: ctx.authHeader(fx.ownerToken),
    });
    expect(deleted.statusCode).toBe(204);

    const gone = await ctx.prisma.subtask.findUnique({ where: { id: subtaskId } });
    expect(gone).toBeNull();
  });
});
