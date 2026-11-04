import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { activatePendingInvitesForEmail } from '../src/lib/members.js';
import { boardMembers, notes, shareLinks } from '../src/lib/postgres/schema/index.js';
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
  describe('expiry and members who joined by link', () => {
    const DAY = 86_400_000;

    async function createLink(fx: Awaited<ReturnType<typeof createBoardFixture>>, payload: object) {
      return ctx.inject({
        method: 'POST',
        url: `/whiteboards/${fx.boardId}/share-link`,
        headers: ctx.authHeader(fx.ownerToken),
        payload,
      });
    }
    async function redeem(token: string, authToken: string) {
      return ctx.inject({
        method: 'POST',
        url: `/share-links/${token}/redeem`,
        headers: ctx.authHeader(authToken),
      });
    }
    async function setExpiry(boardId: string, offset: string) {
      await ctx.db.execute(
        sql`update share_links set expires_at = now() + ${offset}::interval where board_id = ${boardId}`,
      );
    }
    const storedLink = async (boardId: string) =>
      (await ctx.db.select().from(shareLinks).where(eq(shareLinks.boardId, boardId)))[0];
    const outsiderRow = async (boardId: string) =>
      (
        await ctx.db
          .select()
          .from(boardMembers)
          .where(and(eq(boardMembers.boardId, boardId), eq(boardMembers.userId, 'fx-outsider')))
      )[0];
    const boardStatus = async (boardId: string, authToken: string) =>
      (
        await ctx.inject({
          method: 'GET',
          url: `/whiteboards/${boardId}`,
          headers: ctx.authHeader(authToken),
        })
      ).statusCode;
    async function assignedNote(
      id: string,
      boardId: string,
      assigneeId: string,
      privateNote = false,
    ) {
      const at = new Date();
      await ctx.db.insert(notes).values({
        id,
        boardId,
        title: id,
        status: 'OPEN',
        priority: 'MEDIUM',
        horizon: 'THIS_WEEK',
        freeX: 0,
        freeY: 0,
        colour: 'CHALK',
        createdById: assigneeId,
        assigneeId,
        visibility: privateNote ? 'PRIVATE' : 'SHARED',
        createdAt: at,
        updatedAt: at,
      });
    }
    const assigneeOf = async (id: string) =>
      (await ctx.db.select().from(notes).where(eq(notes.id, id)))[0]!.assigneeId;

    it('defaults a new link to 30 days and stores no date for NEVER', async () => {
      const fx = await createBoardFixture(ctx);
      const before = Date.now();
      const created = await createLink(fx, { role: 'VIEW' });
      expect(created.statusCode).toBe(201);
      const expiresAt = Date.parse(created.json().expiresAt);
      expect(expiresAt - before).toBeGreaterThanOrEqual(30 * DAY - 1000);
      expect(expiresAt - before).toBeLessThanOrEqual(30 * DAY + 5000);

      await ctx.inject({
        method: 'DELETE',
        url: `/whiteboards/${fx.boardId}/share-link`,
        headers: ctx.authHeader(fx.ownerToken),
      });
      const never = await createLink(fx, { role: 'VIEW', expiresIn: 'NEVER' });
      expect(never.json().expiresAt).toBeNull();
      expect((await storedLink(fx.boardId))!.expiresAt).toBeNull();
    });

    it('rejects an unknown duration and an empty update', async () => {
      const fx = await createBoardFixture(ctx);
      expect((await createLink(fx, { role: 'VIEW', expiresIn: 'DAYS_90' })).statusCode).toBe(400);
      await createLink(fx, { role: 'VIEW' });
      const empty = await ctx.inject({
        method: 'PATCH',
        url: `/whiteboards/${fx.boardId}/share-link`,
        headers: ctx.authHeader(fx.ownerToken),
        payload: {},
      });
      expect(empty.statusCode).toBe(400);
    });

    it('keeps the date on a role change, counts a new duration from now, and keeps it on rotate', async () => {
      const fx = await createBoardFixture(ctx);
      const created = await createLink(fx, { role: 'VIEW', expiresIn: 'DAYS_30' });
      const original = created.json().expiresAt;

      const roleOnly = await ctx.inject({
        method: 'PATCH',
        url: `/whiteboards/${fx.boardId}/share-link`,
        headers: ctx.authHeader(fx.ownerToken),
        payload: { role: 'EDIT' },
      });
      expect(roleOnly.json().expiresAt).toBe(original);

      const before = Date.now();
      const sevenDays = await ctx.inject({
        method: 'PATCH',
        url: `/whiteboards/${fx.boardId}/share-link`,
        headers: ctx.authHeader(fx.ownerToken),
        payload: { expiresIn: 'DAYS_7' },
      });
      expect(sevenDays.json().role).toBe('EDIT');
      const changed = Date.parse(sevenDays.json().expiresAt);
      expect(changed - before).toBeGreaterThanOrEqual(7 * DAY - 1000);
      expect(changed - before).toBeLessThanOrEqual(7 * DAY + 5000);

      const rotated = await ctx.inject({
        method: 'POST',
        url: `/whiteboards/${fx.boardId}/share-link/rotate`,
        headers: ctx.authHeader(fx.ownerToken),
      });
      expect(rotated.json().expiresAt).toBe(sevenDays.json().expiresAt);
    });

    it('refuses a link a second past its expiry and accepts it a second before', async () => {
      const fx = await createBoardFixture(ctx);
      const token = (await createLink(fx, { role: 'VIEW' })).json().token;

      await setExpiry(fx.boardId, '-1 second');
      expect((await redeem(token, fx.outsiderToken)).statusCode).toBe(404);
      expect((await redeem(token, fx.ownerToken)).statusCode).toBe(404);
      expect(await outsiderRow(fx.boardId)).toBeUndefined();

      await setExpiry(fx.boardId, '1 second');
      expect((await redeem(token, fx.outsiderToken)).statusCode).toBe(200);
    });

    it('marks a new member as joined by link and shows it in the member list', async () => {
      const fx = await createBoardFixture(ctx);
      const token = (await createLink(fx, { role: 'EDIT' })).json().token;
      await redeem(token, fx.outsiderToken);
      expect((await outsiderRow(fx.boardId))!.joinedByLink).toBe(true);

      const members = await ctx.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}/members`,
        headers: ctx.authHeader(fx.ownerToken),
      });
      const byUser = Object.fromEntries(
        members
          .json()
          .map((m: { userId: string; joinedByLink: boolean }) => [m.userId, m.joinedByLink]),
      );
      expect(byUser).toMatchObject({ 'fx-outsider': true, 'fx-editor': false });
    });

    it('rotate and delete remove link members and release only their shared notes', async () => {
      for (const action of ['rotate', 'delete'] as const) {
        const fx = await createBoardFixture(ctx);
        const token = (await createLink(fx, { role: 'EDIT' })).json().token;
        await redeem(token, fx.outsiderToken);
        await assignedNote(`n-shared-${action}`, fx.boardId, 'fx-outsider');
        await assignedNote(`n-private-${action}`, fx.boardId, 'fx-outsider', true);
        await assignedNote(`n-editor-${action}`, fx.boardId, 'fx-editor');

        const res = await ctx.inject(
          action === 'rotate'
            ? {
                method: 'POST',
                url: `/whiteboards/${fx.boardId}/share-link/rotate`,
                headers: ctx.authHeader(fx.ownerToken),
              }
            : {
                method: 'DELETE',
                url: `/whiteboards/${fx.boardId}/share-link`,
                headers: ctx.authHeader(fx.ownerToken),
              },
        );
        expect(res.statusCode).toBeLessThan(300);

        expect(await outsiderRow(fx.boardId)).toBeUndefined();
        expect(await boardStatus(fx.boardId, fx.outsiderToken)).toBe(404);
        expect(await boardStatus(fx.boardId, fx.editToken)).toBe(200);
        expect(await assigneeOf(`n-shared-${action}`)).toBeNull();
        expect(await assigneeOf(`n-private-${action}`)).toBe('fx-outsider');
        expect(await assigneeOf(`n-editor-${action}`)).toBe('fx-editor');
        await resetDatabase(ctx.db);
      }
    });

    it('an email invite makes a link member permanent', async () => {
      const fx = await createBoardFixture(ctx);
      const token = (await createLink(fx, { role: 'VIEW' })).json().token;
      await redeem(token, fx.outsiderToken);

      const invited = await ctx.inject({
        method: 'POST',
        url: `/whiteboards/${fx.boardId}/members/invite`,
        headers: ctx.authHeader(fx.ownerToken),
        payload: { email: 'outsider@fixture.de', role: 'EDIT' },
      });
      expect(invited.statusCode).toBeLessThan(300);
      expect((await outsiderRow(fx.boardId))!.joinedByLink).toBe(false);

      await ctx.inject({
        method: 'POST',
        url: `/whiteboards/${fx.boardId}/share-link/rotate`,
        headers: ctx.authHeader(fx.ownerToken),
      });
      expect(await boardStatus(fx.boardId, fx.outsiderToken)).toBe(200);
    });

    async function pendingInviteFor(boardId: string, email: string) {
      await ctx.db.insert(boardMembers).values({
        id: `pending-${email}`,
        boardId,
        userId: null,
        invitedEmail: email,
        role: 'EDIT',
        status: 'PENDING',
        invitedAt: new Date(),
      });
    }

    it('an invite activated at sign-in makes an existing link member permanent', async () => {
      const fx = await createBoardFixture(ctx);
      const token = (await createLink(fx, { role: 'VIEW' })).json().token;
      await redeem(token, fx.outsiderToken);
      await pendingInviteFor(fx.boardId, 'outsider@fixture.de');

      await activatePendingInvitesForEmail(ctx.db, 'fx-outsider', 'outsider@fixture.de');
      const row = await outsiderRow(fx.boardId);
      expect(row!.joinedByLink).toBe(false);
      expect(row!.role).toBe('EDIT');
    });

    it('redeeming again with a pending invite waiting makes a link member permanent', async () => {
      const fx = await createBoardFixture(ctx);
      const token = (await createLink(fx, { role: 'VIEW' })).json().token;
      await redeem(token, fx.outsiderToken);
      await pendingInviteFor(fx.boardId, 'outsider@fixture.de');

      expect((await redeem(token, fx.outsiderToken)).statusCode).toBe(200);
      expect((await outsiderRow(fx.boardId))!.joinedByLink).toBe(false);
    });

    it('claiming a pending invite through the link makes the member permanent', async () => {
      const fx = await createBoardFixture(ctx);
      await ctx.db.insert(boardMembers).values({
        id: 'pending-outsider',
        boardId: fx.boardId,
        userId: null,
        invitedEmail: 'outsider@fixture.de',
        role: 'EDIT',
        status: 'PENDING',
        invitedAt: new Date(),
      });
      const token = (await createLink(fx, { role: 'VIEW' })).json().token;
      // The pending invite may already have been activated when the outsider was provisioned;
      // either way, the resulting membership must not count as joined by link.
      await redeem(token, fx.outsiderToken);
      expect((await outsiderRow(fx.boardId))!.joinedByLink).toBe(false);
    });
  });
});
