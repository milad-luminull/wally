import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  docsWithId,
  membersCol,
  notesCol,
  whiteboardsCol,
  withId,
} from '../src/lib/db/collections.js';
import {
  addTestMember,
  buildTestApp,
  createTestMembership,
  createTestShareLink,
  registerTestUser,
  resetDatabase,
  type TestContext,
} from './helpers.js';

const PROJECT_ID = 'wally-test-membership-integrity';

/**
 * A person must hold at most ONE membership row per board. Two rows desync the board's
 * `memberRoles` cache, which is the sole input to resolveRole: the board gets listed twice
 * with conflicting roles, and removing either row deletes the cache entry outright — cutting
 * off access that the surviving row still legitimately grants, while that row lives on
 * invisible to authorization.
 */
describe('membership integrity', () => {
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

  async function authenticate(token: string) {
    return ctx.app.inject({ method: 'GET', url: '/whiteboards', headers: ctx.authHeader(token) });
  }

  const listMembers = async (boardId: string) =>
    docsWithId(await membersCol(ctx.db, boardId).get());
  const memberRoles = async (boardId: string) =>
    withId(await whiteboardsCol(ctx.db).doc(boardId).get())?.memberRoles;

  it('produces a single membership when an invited user redeems a share link before verifying', async () => {
    const ownerToken = registerTestUser(ctx, 'mi-owner', 'mi-owner@finlex.de');
    await authenticate(ownerToken);

    // 1. Invited by address, before she has any account at all -> a PENDING row.
    await ctx.app.inject({
      method: 'POST',
      url: '/whiteboards/mi-owner/members/invite',
      headers: ctx.authHeader(ownerToken),
      payload: { email: 'alice@finlex.de', role: 'EDIT' },
    });

    // 2. She signs up but has not confirmed the address, so the invite stays PENDING.
    const aliceToken = registerTestUser(ctx, 'mi-alice', 'alice@finlex.de', null, false);
    await authenticate(aliceToken);

    // 3. She redeems a VIEW share link. Matching only on userId could not see the row keyed
    //    by invitedEmail, so this used to write a SECOND membership.
    await createTestShareLink(ctx.db, 'mi-tok', 'mi-owner', 'VIEW');
    await ctx.app.inject({
      method: 'POST',
      url: '/share-links/mi-tok/redeem',
      headers: ctx.authHeader(aliceToken),
    });

    // 4. She confirms the address; the pending invite is now claimable.
    ctx.tokens.set(aliceToken, {
      uid: 'mi-alice',
      email: 'alice@finlex.de',
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
    const ownerToken = registerTestUser(ctx, 'mi-owner', 'mi-owner@finlex.de');
    await authenticate(ownerToken);
    const aliceToken = registerTestUser(ctx, 'mi-alice', 'alice@finlex.de');
    await authenticate(aliceToken);

    await addTestMember(ctx.db, 'mi-owner', 'mi-alice', 'VIEW');
    await createTestMembership(ctx.db, 'mi-owner', {
      userId: 'mi-alice',
      role: 'EDIT',
      status: 'ACTIVE',
    });

    const res = await authenticate(aliceToken);
    const boards = res.json() as { id: string; currentUserRole: string }[];

    // Her own board plus the shared one — not the shared one twice with conflicting roles,
    // which is how the desync surfaced to the user.
    expect(boards.filter((b) => b.id === 'mi-owner')).toHaveLength(1);
    // The strongest role is the one authorization will actually grant.
    expect(boards.find((b) => b.id === 'mi-owner')?.currentUserRole).toBe('EDIT');
  });

  it('keeps access when one of two membership rows is removed', async () => {
    const ownerToken = registerTestUser(ctx, 'mi-owner', 'mi-owner@finlex.de');
    await authenticate(ownerToken);
    const aliceToken = registerTestUser(ctx, 'mi-alice', 'alice@finlex.de');
    await authenticate(aliceToken);

    const viewRow = await addTestMember(ctx.db, 'mi-owner', 'mi-alice', 'VIEW');
    await createTestMembership(ctx.db, 'mi-owner', {
      userId: 'mi-alice',
      role: 'EDIT',
      status: 'ACTIVE',
    });

    const removal = await ctx.app.inject({
      method: 'DELETE',
      url: `/whiteboards/mi-owner/members/${viewRow}`,
      headers: ctx.authHeader(ownerToken),
    });
    expect(removal.statusCode).toBe(204);

    // The unconditional FieldValue.delete() stripped the cache entry outright here, revoking
    // all access while the EDIT row survived, invisible to authorization.
    expect(await memberRoles('mi-owner')).toEqual({ 'mi-alice': 'EDIT' });
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/whiteboards/mi-owner',
      headers: ctx.authHeader(aliceToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ currentUserRole: 'EDIT' });
  });

  it('removes access when the last membership row is removed', async () => {
    const ownerToken = registerTestUser(ctx, 'mi-owner', 'mi-owner@finlex.de');
    await authenticate(ownerToken);
    const aliceToken = registerTestUser(ctx, 'mi-alice', 'alice@finlex.de');
    await authenticate(aliceToken);

    const onlyRow = await addTestMember(ctx.db, 'mi-owner', 'mi-alice', 'EDIT');
    await ctx.app.inject({
      method: 'DELETE',
      url: `/whiteboards/mi-owner/members/${onlyRow}`,
      headers: ctx.authHeader(ownerToken),
    });

    expect(await memberRoles('mi-owner')).toEqual({});
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/whiteboards/mi-owner',
      headers: ctx.authHeader(aliceToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it('leaves note assignments alone while a surviving membership row still grants access', async () => {
    const ownerToken = registerTestUser(ctx, 'mi-owner', 'mi-owner@finlex.de');
    await authenticate(ownerToken);
    const aliceToken = registerTestUser(ctx, 'mi-alice', 'alice@finlex.de');
    await authenticate(aliceToken);

    const viewRow = await addTestMember(ctx.db, 'mi-owner', 'mi-alice', 'VIEW');
    await createTestMembership(ctx.db, 'mi-owner', {
      userId: 'mi-alice',
      role: 'EDIT',
      status: 'ACTIVE',
    });

    const note = await ctx.app.inject({
      method: 'POST',
      url: '/whiteboards/mi-owner/notes',
      headers: ctx.authHeader(ownerToken),
      payload: {
        title: 'Zugewiesen',
        priority: 'MITTEL',
        horizon: 'HEUTE',
        freeX: 0,
        freeY: 0,
        colour: 'WEISS',
        assigneeId: 'mi-alice',
      },
    });
    const noteId = note.json().id as string;

    await ctx.app.inject({
      method: 'DELETE',
      url: `/whiteboards/mi-owner/members/${viewRow}`,
      headers: ctx.authHeader(ownerToken),
    });

    // Unassigning is the consequence of losing the board, not of losing one row of several.
    expect(withId(await notesCol(ctx.db).doc(noteId).get())?.assigneeId).toBe('mi-alice');
  });

  it('unassigns the member notes once their last row is gone', async () => {
    const ownerToken = registerTestUser(ctx, 'mi-owner', 'mi-owner@finlex.de');
    await authenticate(ownerToken);
    const aliceToken = registerTestUser(ctx, 'mi-alice', 'alice@finlex.de');
    await authenticate(aliceToken);

    const onlyRow = await addTestMember(ctx.db, 'mi-owner', 'mi-alice', 'EDIT');
    const note = await ctx.app.inject({
      method: 'POST',
      url: '/whiteboards/mi-owner/notes',
      headers: ctx.authHeader(ownerToken),
      payload: {
        title: 'Zugewiesen',
        priority: 'MITTEL',
        horizon: 'HEUTE',
        freeX: 0,
        freeY: 0,
        colour: 'WEISS',
        assigneeId: 'mi-alice',
      },
    });
    const noteId = note.json().id as string;

    await ctx.app.inject({
      method: 'DELETE',
      url: `/whiteboards/mi-owner/members/${onlyRow}`,
      headers: ctx.authHeader(ownerToken),
    });

    expect(withId(await notesCol(ctx.db).doc(noteId).get())?.assigneeId).toBeNull();
  });

  it('does not promote a pending membership into the role cache when its role is edited', async () => {
    const ownerToken = registerTestUser(ctx, 'mi-owner', 'mi-owner@finlex.de');
    await authenticate(ownerToken);

    // A PENDING row that happens to carry a userId — the shape a partially-linked invite
    // leaves behind.
    const pendingRow = await createTestMembership(ctx.db, 'mi-owner', {
      userId: 'mi-alice',
      invitedEmail: 'alice@finlex.de',
      role: 'VIEW',
      status: 'PENDING',
    });

    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/whiteboards/mi-owner/members/${pendingRow}`,
      headers: ctx.authHeader(ownerToken),
      payload: { role: 'EDIT' },
    });
    expect(res.statusCode).toBe(200);

    // memberRoles mirrors ACTIVE members only. Editing a role must not become a back door
    // to live access for an address nobody has confirmed.
    expect(await memberRoles('mi-owner')).toEqual({});
  });
});
