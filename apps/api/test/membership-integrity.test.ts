import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { liveBoard } from '../src/lib/db/records.js';
import { activatePendingInvitesForEmail } from '../src/lib/members.js';
import { boardMembers, notes } from '../src/lib/postgres/schema/index.js';
import {
  addTestMember,
  buildTestApp,
  createTestMembership,
  createTestShareLink,
  registerTestUser,
  resetDatabase,
  type TestContext,
} from './helpers.js';

/**
 * A person must hold at most ONE membership row per board. Two rows list the board twice
 * with conflicting roles, and removing either row must not cut off access that the
 * surviving row still legitimately grants.
 */
describe('membership integrity', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await buildTestApp();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await resetDatabase(ctx.db);
  });

  afterAll(async () => {
    await resetDatabase(ctx.db);
    await ctx.app.close();
  });

  async function authenticate(token: string) {
    return ctx.inject({ method: 'GET', url: '/whiteboards', headers: ctx.authHeader(token) });
  }

  const listMembers = (boardId: string) =>
    ctx.db.select().from(boardMembers).where(eq(boardMembers.boardId, boardId));
  // The roles access checks read: one per user, from that board's ACTIVE member rows.
  const memberRoles = async (boardId: string) => (await liveBoard(ctx.db, boardId))?.memberRoles;
  const assigneeOf = async (noteId: string) =>
    (await ctx.db.select().from(notes).where(eq(notes.id, noteId)))[0]?.assigneeId;

  it('produces a single membership when an invited user redeems a share link before verifying', async () => {
    const ownerToken = registerTestUser(ctx, 'mi-owner', 'mi-owner@example.com');
    await authenticate(ownerToken);

    // 1. Invited by address, before she has any account at all -> a PENDING row.
    await ctx.inject({
      method: 'POST',
      url: '/whiteboards/mi-owner/members/invite',
      headers: ctx.authHeader(ownerToken),
      payload: { email: 'alice@example.com', role: 'EDIT' },
    });

    // 2. She signs up but has not confirmed the address, so the invite stays PENDING.
    const aliceToken = registerTestUser(ctx, 'mi-alice', 'alice@example.com', null, false);
    await authenticate(aliceToken);

    // 3. She redeems a VIEW share link. Matching only on userId could not see the row keyed
    //    by invitedEmail, so this used to write a SECOND membership.
    await createTestShareLink(ctx.db, 'mi-tok', 'mi-owner', 'VIEW');
    await ctx.inject({
      method: 'POST',
      url: '/share-links/mi-tok/redeem',
      headers: ctx.authHeader(aliceToken),
    });

    // 4. She confirms the address; the pending invite is now claimable.
    ctx.tokens.set(aliceToken, {
      uid: 'mi-alice',
      email: 'alice@example.com',
      emailVerified: true,
      name: null,
    });
    await authenticate(aliceToken);

    const members = await listMembers('mi-owner');
    expect(members).toHaveLength(1);
    // The owner's explicit per-person grant outranks the bearer-token link.
    expect(members[0]).toMatchObject({ userId: 'mi-alice', status: 'ACTIVE', role: 'EDIT' });
    expect(await memberRoles('mi-owner')).toEqual({ 'mi-alice': 'EDIT' });
  });

  it('lists a board once even when the caller holds two active membership rows', async () => {
    const ownerToken = registerTestUser(ctx, 'mi-owner', 'mi-owner@example.com');
    await authenticate(ownerToken);
    const aliceToken = registerTestUser(ctx, 'mi-alice', 'alice@example.com');
    await authenticate(aliceToken);

    await addTestMember(ctx.db, 'mi-owner', 'mi-alice', 'VIEW');
    await createTestMembership(ctx.db, 'mi-owner', {
      userId: 'mi-alice',
      role: 'EDIT',
      status: 'ACTIVE',
    });

    const res = await authenticate(aliceToken);
    const boards = res.json() as { id: string; currentUserRole: string }[];

    // Her own board plus the shared one — not the shared one twice with conflicting roles.
    expect(boards.filter((b) => b.id === 'mi-owner')).toHaveLength(1);
    // Read DTOs match live authorization, where the strongest ACTIVE row wins.
    expect(boards.find((b) => b.id === 'mi-owner')?.currentUserRole).toBe('EDIT');
  });

  it('keeps access when one of two membership rows is removed', async () => {
    const ownerToken = registerTestUser(ctx, 'mi-owner', 'mi-owner@example.com');
    await authenticate(ownerToken);
    const aliceToken = registerTestUser(ctx, 'mi-alice', 'alice@example.com');
    await authenticate(aliceToken);

    const viewRow = await addTestMember(ctx.db, 'mi-owner', 'mi-alice', 'VIEW');
    await createTestMembership(ctx.db, 'mi-owner', {
      userId: 'mi-alice',
      role: 'EDIT',
      status: 'ACTIVE',
    });

    const removal = await ctx.inject({
      method: 'DELETE',
      url: `/whiteboards/mi-owner/members/${viewRow}`,
      headers: ctx.authHeader(ownerToken),
    });
    expect(removal.statusCode).toBe(204);

    // Removing one row must not revoke the access the surviving EDIT row still grants.
    expect(await memberRoles('mi-owner')).toEqual({ 'mi-alice': 'EDIT' });
    const res = await ctx.inject({
      method: 'GET',
      url: '/whiteboards/mi-owner',
      headers: ctx.authHeader(aliceToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ currentUserRole: 'EDIT' });
  });

  it('removes access when the last membership row is removed', async () => {
    const ownerToken = registerTestUser(ctx, 'mi-owner', 'mi-owner@example.com');
    await authenticate(ownerToken);
    const aliceToken = registerTestUser(ctx, 'mi-alice', 'alice@example.com');
    await authenticate(aliceToken);

    const onlyRow = await addTestMember(ctx.db, 'mi-owner', 'mi-alice', 'EDIT');
    await ctx.inject({
      method: 'DELETE',
      url: `/whiteboards/mi-owner/members/${onlyRow}`,
      headers: ctx.authHeader(ownerToken),
    });

    expect(await memberRoles('mi-owner')).toEqual({});
    const res = await ctx.inject({
      method: 'GET',
      url: '/whiteboards/mi-owner',
      headers: ctx.authHeader(aliceToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it('leaves note assignments alone while a surviving membership row still grants access', async () => {
    const ownerToken = registerTestUser(ctx, 'mi-owner', 'mi-owner@example.com');
    await authenticate(ownerToken);
    const aliceToken = registerTestUser(ctx, 'mi-alice', 'alice@example.com');
    await authenticate(aliceToken);

    const viewRow = await addTestMember(ctx.db, 'mi-owner', 'mi-alice', 'VIEW');
    await createTestMembership(ctx.db, 'mi-owner', {
      userId: 'mi-alice',
      role: 'EDIT',
      status: 'ACTIVE',
    });

    const note = await ctx.inject({
      method: 'POST',
      url: '/whiteboards/mi-owner/notes',
      headers: ctx.authHeader(ownerToken),
      payload: {
        title: 'Assigned',
        priority: 'MEDIUM',
        horizon: 'TODAY',
        freeX: 0,
        freeY: 0,
        colour: 'CHALK',
        assigneeId: 'mi-alice',
      },
    });
    const noteId = note.json().id as string;

    await ctx.inject({
      method: 'DELETE',
      url: `/whiteboards/mi-owner/members/${viewRow}`,
      headers: ctx.authHeader(ownerToken),
    });

    // Unassigning is the consequence of losing the board, not of losing one row of several.
    expect(await assigneeOf(noteId)).toBe('mi-alice');
  });

  it('unassigns the member notes once their last row is gone', async () => {
    const ownerToken = registerTestUser(ctx, 'mi-owner', 'mi-owner@example.com');
    await authenticate(ownerToken);
    const aliceToken = registerTestUser(ctx, 'mi-alice', 'alice@example.com');
    await authenticate(aliceToken);

    const onlyRow = await addTestMember(ctx.db, 'mi-owner', 'mi-alice', 'EDIT');
    const note = await ctx.inject({
      method: 'POST',
      url: '/whiteboards/mi-owner/notes',
      headers: ctx.authHeader(ownerToken),
      payload: {
        title: 'Assigned',
        priority: 'MEDIUM',
        horizon: 'TODAY',
        freeX: 0,
        freeY: 0,
        colour: 'CHALK',
        assigneeId: 'mi-alice',
      },
    });
    const noteId = note.json().id as string;

    await ctx.inject({
      method: 'DELETE',
      url: `/whiteboards/mi-owner/members/${onlyRow}`,
      headers: ctx.authHeader(ownerToken),
    });

    expect(await assigneeOf(noteId)).toBeNull();
  });

  it('does not promote a pending membership to live access when its role is edited', async () => {
    const ownerToken = registerTestUser(ctx, 'mi-owner', 'mi-owner@example.com');
    await authenticate(ownerToken);

    // A PENDING row that happens to carry a userId — the shape a partially-linked invite
    // leaves behind.
    const pendingRow = await createTestMembership(ctx.db, 'mi-owner', {
      userId: 'mi-alice',
      invitedEmail: 'alice@example.com',
      role: 'VIEW',
      status: 'PENDING',
    });

    const res = await ctx.inject({
      method: 'PATCH',
      url: `/whiteboards/mi-owner/members/${pendingRow}`,
      headers: ctx.authHeader(ownerToken),
      payload: { role: 'EDIT' },
    });
    expect(res.statusCode).toBe(200);

    // Only ACTIVE members hold a role. Editing a role must not become a back door to live
    // access for an address nobody has confirmed.
    expect(await memberRoles('mi-owner')).toEqual({});
  });

  /**
   * Makes the route's own transaction start only after the invite has been activated, so the
   * row it read before the transaction is stale by construction — the interleaving a real
   * sign-in can produce between the route's pre-read and its transaction.
   */
  function activateBeforeNextTransaction(userId: string, email: string) {
    const original = ctx.db.transaction.bind(ctx.db);
    vi.spyOn(ctx.db, 'transaction').mockImplementationOnce(async (fn, config) => {
      await activatePendingInvitesForEmail(ctx.db, userId, email);
      return original(fn, config);
    });
  }

  it('revokes access when an invite activates between the pre-read and the removal', async () => {
    const ownerToken = registerTestUser(ctx, 'mi-owner', 'mi-owner@example.com');
    await authenticate(ownerToken);
    const aliceToken = registerTestUser(ctx, 'mi-alice', 'alice@example.com');
    await authenticate(aliceToken);

    const pendingRow = await createTestMembership(ctx.db, 'mi-owner', {
      userId: null,
      invitedEmail: 'alice@example.com',
      role: 'EDIT',
      status: 'PENDING',
    });

    activateBeforeNextTransaction('mi-alice', 'alice@example.com');
    const res = await ctx.inject({
      method: 'DELETE',
      url: `/whiteboards/mi-owner/members/${pendingRow}`,
      headers: ctx.authHeader(ownerToken),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('STALE_REVISION');
    const reviewed = await ctx.inject({
      method: 'DELETE',
      url: `/whiteboards/mi-owner/members/${pendingRow}`,
      headers: ctx.authHeader(ownerToken),
    });
    expect(reviewed.statusCode).toBe(204);

    expect(await listMembers('mi-owner')).toEqual([]);
    expect(await memberRoles('mi-owner')).toEqual({});
    const board = await ctx.inject({
      method: 'GET',
      url: '/whiteboards/mi-owner',
      headers: ctx.authHeader(aliceToken),
    });
    expect(board.statusCode).toBe(404);
  });

  it('applies a role edit when the invite activates mid-request', async () => {
    const ownerToken = registerTestUser(ctx, 'mi-owner', 'mi-owner@example.com');
    await authenticate(ownerToken);
    const aliceToken = registerTestUser(ctx, 'mi-alice', 'alice@example.com');
    await authenticate(aliceToken);

    const pendingRow = await createTestMembership(ctx.db, 'mi-owner', {
      userId: null,
      invitedEmail: 'alice@example.com',
      role: 'VIEW',
      status: 'PENDING',
    });

    activateBeforeNextTransaction('mi-alice', 'alice@example.com');
    const res = await ctx.inject({
      method: 'PATCH',
      url: `/whiteboards/mi-owner/members/${pendingRow}`,
      headers: ctx.authHeader(ownerToken),
      payload: { role: 'EDIT' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('STALE_REVISION');
    const reviewed = await ctx.inject({
      method: 'PATCH',
      url: `/whiteboards/mi-owner/members/${pendingRow}`,
      headers: ctx.authHeader(ownerToken),
      payload: { role: 'EDIT' },
    });
    expect(reviewed.statusCode).toBe(200);
    expect(reviewed.json()).toMatchObject({ role: 'EDIT', status: 'ACTIVE' });

    expect(await memberRoles('mi-owner')).toEqual({ 'mi-alice': 'EDIT' });
  });
});
