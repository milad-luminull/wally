import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, createBoardFixture, resetDatabase, type TestContext } from './helpers.js';

describe('member/invite routes (owner-only)', () => {
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
      const member = await ctx.prisma.whiteboardMember.findFirstOrThrow({
        where: { whiteboardId: fx.boardId, userId: fx.editorId },
      });

      const patched = await ctx.app.inject({
        method: 'PATCH',
        url: `/whiteboards/${fx.boardId}/members/${member.id}`,
        headers: ctx.authHeader(fx.ownerToken),
        payload: { role: 'VIEW' },
      });
      expect(patched.statusCode).toBe(200);
      expect(patched.json().role).toBe('VIEW');

      const note = await ctx.prisma.note.create({
        data: { whiteboardId: fx.boardId, title: 'Zugewiesen', assigneeId: fx.editorId },
      });

      const forbidden = await ctx.app.inject({
        method: 'DELETE',
        url: `/whiteboards/${fx.boardId}/members/${member.id}`,
        headers: ctx.authHeader(fx.editToken),
      });
      expect(forbidden.statusCode).toBe(403);

      const deleted = await ctx.app.inject({
        method: 'DELETE',
        url: `/whiteboards/${fx.boardId}/members/${member.id}`,
        headers: ctx.authHeader(fx.ownerToken),
      });
      expect(deleted.statusCode).toBe(204);

      const refreshedNote = await ctx.prisma.note.findUniqueOrThrow({ where: { id: note.id } });
      expect(refreshedNote.assigneeId).toBeNull();
    });
  });
});
