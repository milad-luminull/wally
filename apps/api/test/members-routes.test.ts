import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { notesCol, withId } from '../src/lib/db/collections.js';
import {
  buildTestApp,
  createBoardFixture,
  resetDatabase,
  type TestContext,
} from './helpers.js';

const PROJECT_ID = 'wally-test-members-routes';

describe('member/invite routes (owner-only)', () => {
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

  describe('POST /whiteboards/:id/members/invite', () => {
    it('200s for the owner, 403 for EDIT/VIEW, 404 for non-member', async () => {
      const fx = await createBoardFixture(ctx);

      const ok = await ctx.app.inject({
        method: 'POST',
        url: `/whiteboards/${fx.boardId}/members/invite`,
        headers: ctx.authHeader(fx.ownerToken),
        payload: { email: 'new-invitee@finlex.de', role: 'VIEW' },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().status).toBe('PENDING');

      const forbiddenEdit = await ctx.app.inject({
        method: 'POST',
        url: `/whiteboards/${fx.boardId}/members/invite`,
        headers: ctx.authHeader(fx.editToken),
        payload: { email: 'another@finlex.de', role: 'VIEW' },
      });
      expect(forbiddenEdit.statusCode).toBe(403);

      const forbiddenView = await ctx.app.inject({
        method: 'POST',
        url: `/whiteboards/${fx.boardId}/members/invite`,
        headers: ctx.authHeader(fx.viewToken),
        payload: { email: 'another@finlex.de', role: 'VIEW' },
      });
      expect(forbiddenView.statusCode).toBe(403);

      const notFound = await ctx.app.inject({
        method: 'POST',
        url: `/whiteboards/${fx.boardId}/members/invite`,
        headers: ctx.authHeader(fx.outsiderToken),
        payload: { email: 'another@finlex.de', role: 'VIEW' },
      });
      expect(notFound.statusCode).toBe(404);
    });
  });

  describe('PATCH/DELETE /whiteboards/:id/members/:memberId', () => {
    it('owner can change role; deleting a member nulls out their assigned notes', async () => {
      const fx = await createBoardFixture(ctx);

      const patched = await ctx.app.inject({
        method: 'PATCH',
        url: `/whiteboards/${fx.boardId}/members/${fx.editMemberId}`,
        headers: ctx.authHeader(fx.ownerToken),
        payload: { role: 'VIEW' },
      });
      expect(patched.statusCode).toBe(200);
      expect(patched.json().role).toBe('VIEW');

      const created = await ctx.app.inject({
        method: 'POST',
        url: `/whiteboards/${fx.boardId}/notes`,
        headers: ctx.authHeader(fx.ownerToken),
        payload: { title: 'Zugewiesen', assigneeId: fx.editorId },
      });
      expect(created.statusCode).toBe(201);
      const noteId = created.json().id;

      const forbidden = await ctx.app.inject({
        method: 'DELETE',
        url: `/whiteboards/${fx.boardId}/members/${fx.editMemberId}`,
        headers: ctx.authHeader(fx.editToken),
      });
      expect(forbidden.statusCode).toBe(403);

      const deleted = await ctx.app.inject({
        method: 'DELETE',
        url: `/whiteboards/${fx.boardId}/members/${fx.editMemberId}`,
        headers: ctx.authHeader(fx.ownerToken),
      });
      expect(deleted.statusCode).toBe(204);

      const refreshedNote = withId(await notesCol(ctx.db).doc(noteId).get());
      expect(refreshedNote?.assigneeId).toBeNull();
    });
  });
});
