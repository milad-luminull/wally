import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { boardMembers } from '../src/lib/postgres/schema/index.js';
import { buildTestApp, createBoardFixture, resetDatabase, type TestContext } from './helpers.js';

describe('share-link routes', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await buildTestApp();
  });

  afterEach(async () => {
    await resetDatabase(ctx.db);
  });

  afterAll(async () => {
    await resetDatabase(ctx.db);
    await ctx.app.close();
  });

  it('owner-only CRUD + rotate matrix', async () => {
    const fx = await createBoardFixture(ctx);

    const create403 = await ctx.inject({
      method: 'POST',
      url: `/whiteboards/${fx.boardId}/share-link`,
      headers: ctx.authHeader(fx.editToken),
      payload: { role: 'VIEW' },
    });
    expect(create403.statusCode).toBe(403);

    const created = await ctx.inject({
      method: 'POST',
      url: `/whiteboards/${fx.boardId}/share-link`,
      headers: ctx.authHeader(fx.ownerToken),
      payload: { role: 'VIEW' },
    });
    expect(created.statusCode).toBe(201);
    const originalToken = created.json().token;

    const get404ForNonMember = await ctx.inject({
      method: 'GET',
      url: `/whiteboards/${fx.boardId}/share-link`,
      headers: ctx.authHeader(fx.outsiderToken),
    });
    expect(get404ForNonMember.statusCode).toBe(404);

    const patched = await ctx.inject({
      method: 'PATCH',
      url: `/whiteboards/${fx.boardId}/share-link`,
      headers: ctx.authHeader(fx.ownerToken),
      payload: { role: 'EDIT' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().role).toBe('EDIT');

    const rotated = await ctx.inject({
      method: 'POST',
      url: `/whiteboards/${fx.boardId}/share-link/rotate`,
      headers: ctx.authHeader(fx.ownerToken),
    });
    expect(rotated.statusCode).toBe(200);
    expect(rotated.json().token).not.toBe(originalToken);

    // The token is the document's id, so rotation must leave the old URL dead.
    const staleRedeem = await ctx.inject({
      method: 'POST',
      url: `/share-links/${originalToken}/redeem`,
      headers: ctx.authHeader(fx.outsiderToken),
    });
    expect(staleRedeem.statusCode).toBe(404);

    const deleted = await ctx.inject({
      method: 'DELETE',
      url: `/whiteboards/${fx.boardId}/share-link`,
      headers: ctx.authHeader(fx.ownerToken),
    });
    expect(deleted.statusCode).toBe(204);
  });

  describe('POST /share-links/:token/redeem', () => {
    it('404s for an invalid token', async () => {
      const fx = await createBoardFixture(ctx);
      const res = await ctx.inject({
        method: 'POST',
        url: `/share-links/not-a-real-token/redeem`,
        headers: ctx.authHeader(fx.outsiderToken),
      });
      expect(res.statusCode).toBe(404);
    });

    it('grants membership at the link role to a new redeemer', async () => {
      const fx = await createBoardFixture(ctx);
      const created = await ctx.inject({
        method: 'POST',
        url: `/whiteboards/${fx.boardId}/share-link`,
        headers: ctx.authHeader(fx.ownerToken),
        payload: { role: 'EDIT' },
      });
      const token = created.json().token;

      const redeemed = await ctx.inject({
        method: 'POST',
        url: `/share-links/${token}/redeem`,
        headers: ctx.authHeader(fx.outsiderToken),
      });
      expect(redeemed.statusCode).toBe(200);
      expect(redeemed.json()).toEqual({ whiteboardId: fx.boardId, role: 'EDIT' });
    });

    it('is a no-op when the owner redeems their own link', async () => {
      const fx = await createBoardFixture(ctx);
      const created = await ctx.inject({
        method: 'POST',
        url: `/whiteboards/${fx.boardId}/share-link`,
        headers: ctx.authHeader(fx.ownerToken),
        payload: { role: 'VIEW' },
      });
      const token = created.json().token;

      const redeemed = await ctx.inject({
        method: 'POST',
        url: `/share-links/${token}/redeem`,
        headers: ctx.authHeader(fx.ownerToken),
      });
      expect(redeemed.statusCode).toBe(200);

      const members = await ctx.db.$count(boardMembers, eq(boardMembers.boardId, fx.boardId));
      expect(members).toBe(2); // unchanged: still just the fixture's editor + viewer
    });
  });
});
