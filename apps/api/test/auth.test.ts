import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { INITIAL_BOARD_NAME } from '@wally/shared';
import { eq } from 'drizzle-orm';
import { liveBoard } from '../src/lib/db/records.js';
import type { Database } from '../src/lib/postgres/client.js';
import { boardMembers, users } from '../src/lib/postgres/schema/index.js';
import {
  buildTestApp,
  createTestMembership,
  registerTestUser,
  resetDatabase,
  type TestContext,
} from './helpers.js';

async function userRow(db: Database, id: string) {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user;
}

function membersOf(db: Database, boardId: string) {
  return db.select().from(boardMembers).where(eq(boardMembers.boardId, boardId));
}

describe('auth preHandler', () => {
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

  it('401s on a protected route with no Authorization header', async () => {
    const res = await ctx.inject({ method: 'GET', url: '/whiteboards' });
    expect(res.statusCode).toBe(401);
  });

  it('401s on a protected route with an invalid token', async () => {
    const res = await ctx.inject({
      method: 'GET',
      url: '/whiteboards',
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('writes the user record and lazily provisions their whiteboard on first request', async () => {
    const token = registerTestUser(ctx, 'auth-new-user', 'brand-new@example.com', 'Brand New');

    const res = await ctx.inject({
      method: 'GET',
      url: '/whiteboards',
      headers: ctx.authHeader(token),
    });
    expect(res.statusCode).toBe(200);

    const user = await userRow(ctx.db, 'auth-new-user');
    expect(user?.email).toBe('brand-new@example.com');

    // The board's id IS the owner's uid, which is what makes one-board-per-owner
    // structural rather than a constraint.
    const board = await liveBoard(ctx.db, 'auth-new-user');
    expect(board?.name).toBe(INITIAL_BOARD_NAME.de);
    expect(board?.ownerId).toBe('auth-new-user');
  });

  it('auto-activates a pending invite matching the caller email, whatever its casing', async () => {
    const ownerToken = registerTestUser(ctx, 'auth-owner', 'auth-owner@example.com');
    await ctx.inject({
      method: 'GET',
      url: '/whiteboards',
      headers: ctx.authHeader(ownerToken),
    });

    await createTestMembership(ctx.db, 'auth-owner', {
      invitedEmail: 'invitee@example.com',
      role: 'EDIT',
      status: 'PENDING',
    });

    // The invited person authenticates with an email that differs only in case.
    const inviteeToken = registerTestUser(ctx, 'auth-invitee', 'INVITEE@EXAMPLE.COM');
    await ctx.inject({
      method: 'GET',
      url: '/whiteboards',
      headers: ctx.authHeader(inviteeToken),
    });

    const [member] = await membersOf(ctx.db, 'auth-owner');
    expect(member?.status).toBe('ACTIVE');
    expect(member?.userId).toBe('auth-invitee');

    // Activation is only real if authorization can see it: the roles it reads come from the
    // ACTIVE membership rows.
    const board = await liveBoard(ctx.db, 'auth-owner');
    expect(board?.memberRoles).toEqual({ 'auth-invitee': 'EDIT' });
  });

  it('does NOT auto-activate a pending invite for an unverified email claim', async () => {
    // Firebase allows sign-up with an unverified email — without this check, an attacker
    // could claim someone else's pending invite just by typing in their email address,
    // no access to that inbox required.
    const ownerToken = registerTestUser(ctx, 'auth-owner-2', 'auth-owner-2@example.com');
    await ctx.inject({
      method: 'GET',
      url: '/whiteboards',
      headers: ctx.authHeader(ownerToken),
    });

    await createTestMembership(ctx.db, 'auth-owner-2', {
      invitedEmail: 'real-invitee@example.com',
      role: 'EDIT',
      status: 'PENDING',
    });

    const attackerToken = registerTestUser(
      ctx,
      'auth-attacker',
      'real-invitee@example.com',
      null,
      false, // emailVerified: false
    );
    await ctx.inject({
      method: 'GET',
      url: '/whiteboards',
      headers: ctx.authHeader(attackerToken),
    });

    const [member] = await membersOf(ctx.db, 'auth-owner-2');
    expect(member?.status).toBe('PENDING');
    expect(member?.userId).toBeNull();

    const board = await liveBoard(ctx.db, 'auth-owner-2');
    expect(board?.memberRoles).toEqual({});
  });
  it('persists emailVerified on the user record', async () => {
    const token = registerTestUser(ctx, 'auth-verified', 'verified@example.com');
    await ctx.inject({ method: 'GET', url: '/whiteboards', headers: ctx.authHeader(token) });

    const user = await userRow(ctx.db, 'auth-verified');
    expect(user?.emailVerified).toBe(true);
  });

  it('updates a stored emailVerified of false once the caller verifies', async () => {
    const token = registerTestUser(ctx, 'auth-later', 'later@example.com', null, false);
    await ctx.inject({ method: 'GET', url: '/whiteboards', headers: ctx.authHeader(token) });
    expect((await userRow(ctx.db, 'auth-later'))?.emailVerified).toBe(false);

    ctx.tokens.set(token, {
      uid: 'auth-later',
      email: 'later@example.com',
      emailVerified: true,
      name: null,
    });
    await ctx.inject({ method: 'GET', url: '/whiteboards', headers: ctx.authHeader(token) });

    // emailVerified has to take part in the fast-path comparison, or a user who verifies
    // later keeps a stale false forever and the invite waiting on it never activates.
    expect((await userRow(ctx.db, 'auth-later'))?.emailVerified).toBe(true);
  });
});
