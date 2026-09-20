import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { INITIAL_BOARD_NAME } from '@wally/shared';
import {
  docsWithId,
  membersCol,
  now,
  usersCol,
  whiteboardsCol,
  withId,
} from '../src/lib/db/collections.js';
import {
  buildTestApp,
  createTestMembership,
  registerTestUser,
  resetDatabase,
  type TestContext,
} from './helpers.js';

const PROJECT_ID = 'wally-test-auth';

describe('auth preHandler', () => {
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

  it('401s on a protected route with no Authorization header', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/whiteboards' });
    expect(res.statusCode).toBe(401);
  });

  it('401s on a protected route with an invalid token', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/whiteboards',
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('writes the user record and lazily provisions their whiteboard on first request', async () => {
    const token = registerTestUser(ctx, 'auth-new-user', 'brand-new@finlex.de', 'Brand New');

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/whiteboards',
      headers: ctx.authHeader(token),
    });
    expect(res.statusCode).toBe(200);

    const user = withId(await usersCol(ctx.db).doc('auth-new-user').get());
    expect(user?.email).toBe('brand-new@finlex.de');

    // The board's id IS the owner's uid, which is what makes one-board-per-owner
    // structural rather than a constraint.
    const board = withId(await whiteboardsCol(ctx.db).doc('auth-new-user').get());
    expect(board?.name).toBe(INITIAL_BOARD_NAME.de);
    expect(board?.ownerId).toBe('auth-new-user');
  });

  it('auto-activates a pending invite matching the caller email, whatever its casing', async () => {
    const ownerToken = registerTestUser(ctx, 'auth-owner', 'auth-owner@finlex.de');
    await ctx.app.inject({ method: 'GET', url: '/whiteboards', headers: ctx.authHeader(ownerToken) });

    await createTestMembership(ctx.db, 'auth-owner', {
      invitedEmail: 'invitee@finlex.de',
      role: 'EDIT',
      status: 'PENDING',
    });

    // The invited person authenticates with an email that differs only in case.
    const inviteeToken = registerTestUser(ctx, 'auth-invitee', 'INVITEE@FINLEX.DE');
    await ctx.app.inject({ method: 'GET', url: '/whiteboards', headers: ctx.authHeader(inviteeToken) });

    const [member] = docsWithId(await membersCol(ctx.db, 'auth-owner').get());
    expect(member?.status).toBe('ACTIVE');
    expect(member?.userId).toBe('auth-invitee');

    // Activation is only real if authorization can see it.
    const board = withId(await whiteboardsCol(ctx.db).doc('auth-owner').get());
    expect(board?.memberRoles).toEqual({ 'auth-invitee': 'EDIT' });
  });

  it('does NOT auto-activate a pending invite for an unverified email claim', async () => {
    // Firebase allows sign-up with an unverified email — without this check, an attacker
    // could claim someone else's pending invite just by typing in their email address,
    // no access to that inbox required.
    const ownerToken = registerTestUser(ctx, 'auth-owner-2', 'auth-owner-2@finlex.de');
    await ctx.app.inject({ method: 'GET', url: '/whiteboards', headers: ctx.authHeader(ownerToken) });

    await createTestMembership(ctx.db, 'auth-owner-2', {
      invitedEmail: 'real-invitee@finlex.de',
      role: 'EDIT',
      status: 'PENDING',
    });

    const attackerToken = registerTestUser(
      ctx,
      'auth-attacker',
      'real-invitee@finlex.de',
      null,
      false, // emailVerified: false
    );
    await ctx.app.inject({ method: 'GET', url: '/whiteboards', headers: ctx.authHeader(attackerToken) });

    const [member] = docsWithId(await membersCol(ctx.db, 'auth-owner-2').get());
    expect(member?.status).toBe('PENDING');
    expect(member?.userId).toBeNull();

    const board = withId(await whiteboardsCol(ctx.db).doc('auth-owner-2').get());
    expect(board?.memberRoles).toEqual({});
  });
  it('persists emailVerified on the user record', async () => {
    const token = registerTestUser(ctx, 'auth-verified', 'verified@finlex.de');
    await ctx.app.inject({ method: 'GET', url: '/whiteboards', headers: ctx.authHeader(token) });

    const user = withId(await usersCol(ctx.db).doc('auth-verified').get());
    expect(user?.emailVerified).toBe(true);
  });

  it('updates a stored emailVerified of false once the caller verifies', async () => {
    const token = registerTestUser(ctx, 'auth-later', 'later@finlex.de', null, false);
    await ctx.app.inject({ method: 'GET', url: '/whiteboards', headers: ctx.authHeader(token) });
    expect(withId(await usersCol(ctx.db).doc('auth-later').get())?.emailVerified).toBe(false);

    ctx.tokens.set(token, {
      uid: 'auth-later',
      email: 'later@finlex.de',
      emailVerified: true,
      name: null,
    });
    await ctx.app.inject({ method: 'GET', url: '/whiteboards', headers: ctx.authHeader(token) });

    // emailVerified has to take part in the fast-path comparison, or a user who verifies
    // later keeps a stale false forever and the invite waiting on it never activates.
    expect(withId(await usersCol(ctx.db).doc('auth-later').get())?.emailVerified).toBe(true);
  });

  it('backfills emailVerified on a user record written before the field existed', async () => {
    const timestamp = now();
    // Deliberately field-less, bypassing the typed collection helper.
    await ctx.db.collection('users').doc('auth-legacy').set({
      email: 'legacy@finlex.de',
      displayName: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const token = registerTestUser(ctx, 'auth-legacy', 'legacy@finlex.de');
    await ctx.app.inject({ method: 'GET', url: '/whiteboards', headers: ctx.authHeader(token) });

    // An absent flag reads as false, so this one migrating write is forced — and it is also
    // the one sweep that recovers any invite the pre-fix code left stranded.
    expect(withId(await usersCol(ctx.db).doc('auth-legacy').get())?.emailVerified).toBe(true);
  });
});
