import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, createBoardFixture, resetDatabase, type TestContext } from './helpers.js';

describe('whiteboard routes', () => {
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

  describe('GET /whiteboards/:id', () => {
    it('200s for the owner', async () => {
      const fx = await createBoardFixture(ctx);
      const res = await ctx.app.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}`,
        headers: ctx.authHeader(fx.ownerToken),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().currentUserRole).toBe('OWNER');
    });

    it('200s for an active EDIT member', async () => {
      const fx = await createBoardFixture(ctx);
      const res = await ctx.app.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}`,
        headers: ctx.authHeader(fx.editToken),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().currentUserRole).toBe('EDIT');
    });

    it('200s for an active VIEW member', async () => {
      const fx = await createBoardFixture(ctx);
      const res = await ctx.app.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}`,
        headers: ctx.authHeader(fx.viewToken),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().currentUserRole).toBe('VIEW');
    });

    it('404s for a non-member (never reveals existence)', async () => {
      const fx = await createBoardFixture(ctx);
      const res = await ctx.app.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}`,
        headers: ctx.authHeader(fx.outsiderToken),
      });
      expect(res.statusCode).toBe(404);
    });

    it('404s for a nonexistent whiteboard id', async () => {
      const fx = await createBoardFixture(ctx);
      const res = await ctx.app.inject({
        method: 'GET',
        url: `/whiteboards/does-not-exist`,
        headers: ctx.authHeader(fx.ownerToken),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('PATCH /whiteboards/:id (owner-only rename)', () => {
    it('200s and renames for the owner', async () => {
      const fx = await createBoardFixture(ctx);
      const res = await ctx.app.inject({
        method: 'PATCH',
        url: `/whiteboards/${fx.boardId}`,
        headers: ctx.authHeader(fx.ownerToken),
        payload: { name: 'Neuer Name' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe('Neuer Name');
    });

    it('403s for an EDIT member', async () => {
      const fx = await createBoardFixture(ctx);
      const res = await ctx.app.inject({
        method: 'PATCH',
        url: `/whiteboards/${fx.boardId}`,
        headers: ctx.authHeader(fx.editToken),
        payload: { name: 'Nope' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('403s for a VIEW member', async () => {
      const fx = await createBoardFixture(ctx);
      const res = await ctx.app.inject({
        method: 'PATCH',
        url: `/whiteboards/${fx.boardId}`,
        headers: ctx.authHeader(fx.viewToken),
        payload: { name: 'Nope' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('404s for a non-member', async () => {
      const fx = await createBoardFixture(ctx);
      const res = await ctx.app.inject({
        method: 'PATCH',
        url: `/whiteboards/${fx.boardId}`,
        headers: ctx.authHeader(fx.outsiderToken),
        payload: { name: 'Nope' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /whiteboards/:id/members', () => {
    it('200s for owner, EDIT, and VIEW; 404 for non-member', async () => {
      const fx = await createBoardFixture(ctx);
      for (const token of [fx.ownerToken, fx.editToken, fx.viewToken]) {
        const res = await ctx.app.inject({
          method: 'GET',
          url: `/whiteboards/${fx.boardId}/members`,
          headers: ctx.authHeader(token),
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toHaveLength(2);
      }
      const res = await ctx.app.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}/members`,
        headers: ctx.authHeader(fx.outsiderToken),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /whiteboards/:id/tags', () => {
    it('returns distinct tags in use, and 404s for a non-member', async () => {
      const fx = await createBoardFixture(ctx);
      await ctx.prisma.note.createMany({
        data: [
          { whiteboardId: fx.boardId, title: 'A', tags: ['Cyber', 'Review'] },
          { whiteboardId: fx.boardId, title: 'B', tags: ['Cyber'] },
        ],
      });

      const res = await ctx.app.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}/tags`,
        headers: ctx.authHeader(fx.viewToken),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().sort()).toEqual(['Cyber', 'Review']);

      const forbidden = await ctx.app.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}/tags`,
        headers: ctx.authHeader(fx.outsiderToken),
      });
      expect(forbidden.statusCode).toBe(404);
    });
  });

  describe('GET /whiteboards (caller list)', () => {
    it('lists boards owned or actively membered by the caller', async () => {
      const fx = await createBoardFixture(ctx);

      const ownerRes = await ctx.app.inject({
        method: 'GET',
        url: '/whiteboards',
        headers: ctx.authHeader(fx.ownerToken),
      });
      const ownerBoards = ownerRes.json();
      expect(ownerBoards.some((b: { id: string }) => b.id === fx.boardId)).toBe(true);

      const editRes = await ctx.app.inject({
        method: 'GET',
        url: '/whiteboards',
        headers: ctx.authHeader(fx.editToken),
      });
      const editBoards = editRes.json();
      const membered = editBoards.find((b: { id: string }) => b.id === fx.boardId);
      expect(membered.currentUserRole).toBe('EDIT');
    });
  });
});
