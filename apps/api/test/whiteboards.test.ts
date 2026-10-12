import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, createBoardFixture, resetDatabase, type TestContext } from './helpers.js';

const PROJECT_ID = 'wally-test-whiteboards';

describe('whiteboard routes', () => {
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

  describe('GET /whiteboards/:id', () => {
    it('200s for the owner', async () => {
      const fx = await createBoardFixture(ctx);
      const res = await ctx.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}`,
        headers: ctx.authHeader(fx.ownerToken),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().currentUserRole).toBe('OWNER');
    });

    it('200s for an active EDIT member', async () => {
      const fx = await createBoardFixture(ctx);
      const res = await ctx.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}`,
        headers: ctx.authHeader(fx.editToken),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().currentUserRole).toBe('EDIT');
    });

    it('200s for an active VIEW member', async () => {
      const fx = await createBoardFixture(ctx);
      const res = await ctx.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}`,
        headers: ctx.authHeader(fx.viewToken),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().currentUserRole).toBe('VIEW');
    });

    it('404s for a non-member (never reveals existence)', async () => {
      const fx = await createBoardFixture(ctx);
      const res = await ctx.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}`,
        headers: ctx.authHeader(fx.outsiderToken),
      });
      expect(res.statusCode).toBe(404);
    });

    it('404s for a nonexistent whiteboard id', async () => {
      const fx = await createBoardFixture(ctx);
      const res = await ctx.inject({
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
      const res = await ctx.inject({
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
      const res = await ctx.inject({
        method: 'PATCH',
        url: `/whiteboards/${fx.boardId}`,
        headers: ctx.authHeader(fx.editToken),
        payload: { name: 'Nope' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('403s for a VIEW member', async () => {
      const fx = await createBoardFixture(ctx);
      const res = await ctx.inject({
        method: 'PATCH',
        url: `/whiteboards/${fx.boardId}`,
        headers: ctx.authHeader(fx.viewToken),
        payload: { name: 'Nope' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('404s for a non-member', async () => {
      const fx = await createBoardFixture(ctx);
      const res = await ctx.inject({
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
        const res = await ctx.inject({
          method: 'GET',
          url: `/whiteboards/${fx.boardId}/members`,
          headers: ctx.authHeader(token),
        });
        expect(res.statusCode).toBe(200);
        // Two stored member rows plus the synthetic owner row.
        expect(res.json()).toHaveLength(3);
      }
      const res = await ctx.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}/members`,
        headers: ctx.authHeader(fx.outsiderToken),
      });
      expect(res.statusCode).toBe(404);
    });

    it('includes the owner first, so a note can be assigned to them', async () => {
      const fx = await createBoardFixture(ctx);
      const res = await ctx.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}/members`,
        headers: ctx.authHeader(fx.ownerToken),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()[0]).toMatchObject({
        id: `owner:${fx.ownerId}`,
        userId: fx.ownerId,
        role: 'OWNER',
        status: 'ACTIVE',
      });
      // The owner has no member document, so their row must not be editable or removable.
      for (const method of ['PATCH', 'DELETE'] as const) {
        const denied = await ctx.inject({
          method,
          url: `/whiteboards/${fx.boardId}/members/owner:${fx.ownerId}`,
          headers: ctx.authHeader(fx.ownerToken),
          ...(method === 'PATCH' ? { payload: { role: 'VIEW' } } : {}),
        });
        expect(denied.statusCode).toBe(404);
      }
    });
  });

  describe('GET /whiteboards/:id/tags', () => {
    it('returns distinct tags in use, and 404s for a non-member', async () => {
      const fx = await createBoardFixture(ctx);
      for (const payload of [
        { title: 'A', tags: ['Cyber', 'Review'] },
        { title: 'B', tags: ['Cyber'] },
      ]) {
        await ctx.inject({
          method: 'POST',
          url: `/whiteboards/${fx.boardId}/notes`,
          headers: ctx.authHeader(fx.ownerToken),
          payload,
        });
      }

      const res = await ctx.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}/tags`,
        headers: ctx.authHeader(fx.viewToken),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().sort()).toEqual(['Cyber', 'Review']);

      const forbidden = await ctx.inject({
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

      const ownerRes = await ctx.inject({
        method: 'GET',
        url: '/whiteboards',
        headers: ctx.authHeader(fx.ownerToken),
      });
      const ownerBoards = ownerRes.json();
      expect(ownerBoards.some((b: { id: string }) => b.id === fx.boardId)).toBe(true);

      const editRes = await ctx.inject({
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
