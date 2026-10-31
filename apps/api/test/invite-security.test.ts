import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { liveBoard } from '../src/lib/db/records.js';
import { boardMembers, users } from '../src/lib/postgres/schema/index.js';
import { buildTestApp, registerTestUser, resetDatabase, type TestContext } from './helpers.js';

/**
 * Firebase permits sign-up with an address you do not control, so a `users` record is not
 * evidence of owning the email on it. These cover the invite path end to end, because the
 * gap that made this exploitable was a route-level one: plugins/auth.ts checked
 * emailVerified before activating a PENDING invite, while upsertInvite reached the ACTIVE
 * path without checking anything at all.
 */
describe('invite security', () => {
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

  // The roles access checks read: one per user, from that board's ACTIVE member rows.
  const memberRoles = async (boardId: string) => (await liveBoard(ctx.db, boardId))?.memberRoles;
  const loadUser = async (id: string) =>
    (await ctx.db.select().from(users).where(eq(users.id, id)))[0];

  /** Drives one request per token so the auth preHandler provisions each identity. */
  async function authenticate(token: string) {
    return ctx.inject({ method: 'GET', url: '/whiteboards', headers: ctx.authHeader(token) });
  }

  async function inviteFromOwner(ownerToken: string, email: string, role: 'EDIT' | 'VIEW') {
    return ctx.inject({
      method: 'POST',
      url: '/whiteboards/sec-owner/members/invite',
      headers: ctx.authHeader(ownerToken),
      payload: { email, role },
    });
  }

  it('leaves an invite pending when the only user record for that address is unverified', async () => {
    // The attacker signs up claiming the victim's address without confirming it, and makes
    // one request so their user record exists before the invite is ever sent.
    const attackerToken = registerTestUser(ctx, 'sec-attacker', 'victim@example.com', null, false);
    await authenticate(attackerToken);

    const ownerToken = registerTestUser(ctx, 'sec-owner', 'sec-owner@example.com');
    await authenticate(ownerToken);

    const res = await inviteFromOwner(ownerToken, 'victim@example.com', 'EDIT');

    expect(res.statusCode).toBe(200);
    // Linking the invite to that record would hand the attacker the role the owner meant
    // for the real owner of the inbox. It has to stay keyed by the address instead.
    expect(res.json()).toMatchObject({ status: 'PENDING', userId: null });

    // memberRoles is the sole input to resolveRole — an entry here IS access.
    expect(await memberRoles('sec-owner')).toEqual({});
  });

  it('404s the unverified claimant on the board they were never really invited to', async () => {
    const attackerToken = registerTestUser(ctx, 'sec-attacker', 'victim@example.com', null, false);
    await authenticate(attackerToken);
    const ownerToken = registerTestUser(ctx, 'sec-owner', 'sec-owner@example.com');
    await authenticate(ownerToken);
    await inviteFromOwner(ownerToken, 'victim@example.com', 'EDIT');

    const res = await ctx.inject({
      method: 'GET',
      url: '/whiteboards/sec-owner',
      headers: ctx.authHeader(attackerToken),
    });

    // 404 rather than 403: resolveRole returns null, and a non-member must not be able to
    // learn that the board exists at all.
    expect(res.statusCode).toBe(404);
  });

  it('activates the invite for the verified owner of the address, not the squatter', async () => {
    const attackerToken = registerTestUser(ctx, 'sec-attacker', 'victim@example.com', null, false);
    await authenticate(attackerToken);
    const ownerToken = registerTestUser(ctx, 'sec-owner', 'sec-owner@example.com');
    await authenticate(ownerToken);
    await inviteFromOwner(ownerToken, 'victim@example.com', 'EDIT');

    // A different uid now authenticates with the same address, verified this time.
    const victimToken = registerTestUser(ctx, 'sec-victim', 'victim@example.com');
    await authenticate(victimToken);

    const members = await ctx.db
      .select()
      .from(boardMembers)
      .where(eq(boardMembers.boardId, 'sec-owner'));
    // Exactly one row: the pending invite is linked, not duplicated alongside it.
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ userId: 'sec-victim', status: 'ACTIVE', role: 'EDIT' });

    expect(await memberRoles('sec-owner')).toEqual({ 'sec-victim': 'EDIT' });
  });

  it('activates a pending invite on the request where the caller first appears verified', async () => {
    // Same uid throughout: the record is created unverified, then the address is confirmed.
    const token = registerTestUser(ctx, 'sec-late', 'late@example.com', null, false);
    await authenticate(token);

    const ownerToken = registerTestUser(ctx, 'sec-owner', 'sec-owner@example.com');
    await authenticate(ownerToken);
    await inviteFromOwner(ownerToken, 'late@example.com', 'VIEW');

    ctx.tokens.set(token, {
      uid: 'sec-late',
      email: 'late@example.com',
      emailVerified: true,
      name: null,
    });
    await authenticate(token);

    // emailVerified flipping is one of only two moments the gated sweep still runs, so it
    // has to count as a provisioning write — otherwise the invite is stranded for good.
    expect(await memberRoles('sec-owner')).toEqual({ 'sec-late': 'VIEW' });
  });

  it('stops rewriting the user record once the caller is in steady state', async () => {
    const token = registerTestUser(ctx, 'sec-steady', 'steady@example.com');
    await authenticate(token);
    const first = await loadUser('sec-steady');

    await authenticate(token);
    const second = await loadUser('sec-steady');

    // An unchanged updatedAt proves the fast path engaged, which is what gates the
    // pending-invite sweep away from every steady-state request.
    expect(second?.updatedAt.getTime()).toBe(first?.updatedAt.getTime());
  });
});
