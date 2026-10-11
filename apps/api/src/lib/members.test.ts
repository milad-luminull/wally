import { beforeEach, describe, expect, it } from 'vitest';
import {
  createTestBoard,
  createTestMembership,
  createTestShareLink,
  createTestUser,
  getTestDb,
  resetDatabase,
} from '../../test/helpers.js';
import { docsWithId, membersCol, whiteboardsCol, withId } from './db/collections.js';
import { activatePendingInvitesForEmail, redeemShareLink, upsertInvite } from './members.js';

const PROJECT_ID = 'wally-test-members-lib';

describe('members business logic', () => {
  const db = getTestDb(PROJECT_ID);

  beforeEach(async () => {
    await resetDatabase(PROJECT_ID);
  });

  const listMembers = async (boardId: string) => docsWithId(await membersCol(db, boardId).get());
  const memberRoles = async (boardId: string) =>
    (await withId(await whiteboardsCol(db).doc(boardId).get()))?.memberRoles;

  describe('upsertInvite', () => {
    it('creates a PENDING row when no User exists for that email', async () => {
      await createTestUser(db, 'owner', 'owner@example.com');
      const board = await createTestBoard(db, 'owner');

      const member = await upsertInvite(db, board, 'new-person@example.com', 'VIEW');

      expect(member.status).toBe('PENDING');
      expect(member.userId).toBeNull();
      expect(member.invitedEmail).toBe('new-person@example.com');
      expect(member.role).toBe('VIEW');
      // A pending invite grants nothing yet, so it must not reach the role cache.
      expect(await memberRoles(board)).toEqual({});
    });

    it('creates an ACTIVE row immediately when a User already exists for that email', async () => {
      await createTestUser(db, 'owner', 'owner@example.com');
      await createTestUser(db, 'existing', 'existing@example.com');
      const board = await createTestBoard(db, 'owner');

      const member = await upsertInvite(db, board, 'existing@example.com', 'EDIT');

      expect(member.status).toBe('ACTIVE');
      expect(member.userId).toBe('existing');
      expect(member.activatedAt).not.toBeNull();
      expect(await memberRoles(board)).toEqual({ existing: 'EDIT' });
    });

    it('re-inviting updates the role of an existing row instead of erroring', async () => {
      await createTestUser(db, 'owner', 'owner@example.com');
      const board = await createTestBoard(db, 'owner');

      await upsertInvite(db, board, 'person@example.com', 'VIEW');
      const updated = await upsertInvite(db, board, 'person@example.com', 'EDIT');

      expect(await listMembers(board)).toHaveLength(1);
      expect(updated.role).toBe('EDIT');
    });

    it('links a pending invite by invitedEmail once the User record shows up', async () => {
      await createTestUser(db, 'owner', 'owner@example.com');
      const board = await createTestBoard(db, 'owner');

      await upsertInvite(db, board, 'later-signup@example.com', 'VIEW');
      await createTestUser(db, 'later', 'later-signup@example.com');

      const updated = await upsertInvite(db, board, 'later-signup@example.com', 'EDIT');

      expect(updated.status).toBe('ACTIVE');
      expect(updated.userId).toBe('later');
      expect(updated.invitedEmail).toBeNull();
      expect(await listMembers(board)).toHaveLength(1);
      expect(await memberRoles(board)).toEqual({ later: 'EDIT' });
    });

    it('creates a PENDING row when the only user record for that email is unverified', async () => {
      await createTestUser(db, 'owner', 'owner@example.com');
      // Firebase permits sign-up with an address you do not control, so this record proves
      // nothing: it must be treated exactly like no record at all.
      await createTestUser(db, 'squatter', 'invitee@example.com', null, false);
      const board = await createTestBoard(db, 'owner');

      const member = await upsertInvite(db, board, 'invitee@example.com', 'EDIT');

      expect(member).toMatchObject({
        status: 'PENDING',
        userId: null,
        invitedEmail: 'invitee@example.com',
      });
      expect(await memberRoles(board)).toEqual({});
    });

    it('prefers a verified user record over an unverified one with the same email', async () => {
      await createTestUser(db, 'owner', 'owner@example.com');
      // Created first, so it sorts earlier by document id — limit(1) on the unordered
      // equality query would have returned this one and stranded the invite as PENDING for
      // a user whose record already exists, where the gated sweep never looks again.
      await createTestUser(db, 'aaa-squatter', 'invitee@example.com', null, false);
      await createTestUser(db, 'zzz-real', 'invitee@example.com');
      const board = await createTestBoard(db, 'owner');

      const member = await upsertInvite(db, board, 'invitee@example.com', 'EDIT');

      expect(member).toMatchObject({ status: 'ACTIVE', userId: 'zzz-real' });
      expect(await memberRoles(board)).toEqual({ 'zzz-real': 'EDIT' });
    });
  });

  describe('activatePendingInvitesForEmail', () => {
    it('activates a PENDING row regardless of the casing the caller passes', async () => {
      await createTestUser(db, 'owner', 'owner@example.com');
      const board = await createTestBoard(db, 'owner');
      await createTestMembership(db, board, {
        invitedEmail: 'invitee@example.com',
        role: 'VIEW',
        status: 'PENDING',
      });
      // In production this only runs after the auth hook has written the User record for
      // this id (see src/plugins/auth.ts), so the fixture does the same.
      await createTestUser(db, 'new-user-id', 'invitee@example.com');

      const count = await activatePendingInvitesForEmail(db, 'new-user-id', 'INVITEE@Example.com');

      expect(count).toBe(1);
      const [member] = await listMembers(board);
      expect(member?.status).toBe('ACTIVE');
      expect(member?.userId).toBe('new-user-id');
      expect(member?.activatedAt).not.toBeNull();
      expect(await memberRoles(board)).toEqual({ 'new-user-id': 'VIEW' });
    });

    it('does nothing when there is no matching pending invite', async () => {
      const count = await activatePendingInvitesForEmail(db, 'new-user-id', 'nobody@example.com');
      expect(count).toBe(0);
    });

    it('merges a pending invite into the row the user already has on that board', async () => {
      await createTestUser(db, 'owner', 'owner@example.com');
      await createTestUser(db, 'alice', 'alice@example.com');
      const board = await createTestBoard(db, 'owner', { alice: 'VIEW' });
      await createTestMembership(db, board, { userId: 'alice', role: 'VIEW', status: 'ACTIVE' });
      await createTestMembership(db, board, {
        invitedEmail: 'alice@example.com',
        role: 'EDIT',
        status: 'PENDING',
      });

      await activatePendingInvitesForEmail(db, 'alice', 'alice@example.com');

      // Two ACTIVE rows for one person desync memberRoles: removing one deletes the entry
      // while the other still grants access.
      expect(await listMembers(board)).toHaveLength(1);
      // The owner's explicit invite is the authoritative grant, so its role wins the merge.
      expect(await memberRoles(board)).toEqual({ alice: 'EDIT' });
    });

    it('clears invitedEmail on the row it activates', async () => {
      await createTestUser(db, 'owner', 'owner@example.com');
      await createTestUser(db, 'alice', 'alice@example.com');
      const board = await createTestBoard(db, 'owner');
      await createTestMembership(db, board, {
        invitedEmail: 'alice@example.com',
        role: 'EDIT',
        status: 'PENDING',
      });

      await activatePendingInvitesForEmail(db, 'alice', 'alice@example.com');

      // A row still carrying an address stays claimable by anyone who later verifies it.
      const [member] = await listMembers(board);
      expect(member?.invitedEmail).toBeNull();
      expect(member?.userId).toBe('alice');
    });

    it('skips a pending invite whose board no longer exists', async () => {
      await createTestUser(db, 'alice', 'alice@example.com');
      // A member subcollection can outlive its parent document in Firestore.
      await createTestMembership(db, 'vanished-board', {
        invitedEmail: 'alice@example.com',
        role: 'EDIT',
        status: 'PENDING',
      });

      // A single batch would have failed the whole commit here — inside the auth hook, so
      // every other board's activation would go down with it, on every request.
      await expect(activatePendingInvitesForEmail(db, 'alice', 'alice@example.com')).resolves.toBe(
        0,
      );
    });

    it('drops a pending invite addressed to the board owner rather than making them a member', async () => {
      await createTestUser(db, 'owner', 'owner@example.com');
      const board = await createTestBoard(db, 'owner');
      await createTestMembership(db, board, {
        invitedEmail: 'owner@example.com',
        role: 'VIEW',
        status: 'PENDING',
      });

      await activatePendingInvitesForEmail(db, 'owner', 'owner@example.com');

      // The owner is OWNER through ownerId; a member row for them would list their own
      // board twice and could only ever describe a weaker role than they already have.
      expect(await listMembers(board)).toHaveLength(0);
      expect(await memberRoles(board)).toEqual({});
    });
  });

  describe('redeemShareLink', () => {
    /** redeemShareLink takes the caller, not a bare uid: claiming an invite keyed by
     *  invitedEmail is only allowed for an address Firebase has confirmed. */
    const caller = (id: string, email: string, emailVerified = true) => ({
      id,
      email,
      emailVerified,
    });

    it('returns null for an invalid token', async () => {
      await expect(
        redeemShareLink(db, 'nonexistent-token', caller('some-user', 's@example.com')),
      ).resolves.toBeNull();
    });

    it('is a no-op when the owner redeems their own link', async () => {
      await createTestUser(db, 'owner', 'owner@example.com');
      const board = await createTestBoard(db, 'owner');
      await createTestShareLink(db, 'tok', board, 'EDIT');

      const result = await redeemShareLink(db, 'tok', caller('owner', 'owner@example.com'));

      expect(result).toEqual({ whiteboardId: board, role: 'EDIT' });
      expect(await listMembers(board)).toHaveLength(0);
    });

    it('creates a new ACTIVE membership at the link role for a first-time redeemer', async () => {
      await createTestUser(db, 'owner', 'owner@example.com');
      await createTestUser(db, 'redeemer', 'r@example.com');
      const board = await createTestBoard(db, 'owner');
      await createTestShareLink(db, 'tok', board, 'VIEW');

      const result = await redeemShareLink(db, 'tok', caller('redeemer', 'r@example.com'));

      expect(result).toEqual({ whiteboardId: board, role: 'VIEW' });
      const [member] = await listMembers(board);
      expect(member?.status).toBe('ACTIVE');
      expect(member?.role).toBe('VIEW');
      expect(await memberRoles(board)).toEqual({ redeemer: 'VIEW' });
    });

    it('upgrades an existing VIEW membership when redeeming an EDIT link', async () => {
      await createTestUser(db, 'owner', 'owner@example.com');
      await createTestUser(db, 'redeemer', 'r@example.com');
      const board = await createTestBoard(db, 'owner', { redeemer: 'VIEW' });
      await createTestMembership(db, board, {
        userId: 'redeemer',
        role: 'VIEW',
        status: 'ACTIVE',
      });
      await createTestShareLink(db, 'tok', board, 'EDIT');

      const result = await redeemShareLink(db, 'tok', caller('redeemer', 'r@example.com'));

      expect(result?.role).toBe('EDIT');
      expect(await memberRoles(board)).toEqual({ redeemer: 'EDIT' });
    });

    it('never downgrades an existing EDIT membership when redeeming a VIEW link', async () => {
      await createTestUser(db, 'owner', 'owner@example.com');
      await createTestUser(db, 'redeemer', 'r@example.com');
      const board = await createTestBoard(db, 'owner', { redeemer: 'EDIT' });
      await createTestMembership(db, board, {
        userId: 'redeemer',
        role: 'EDIT',
        status: 'ACTIVE',
      });
      await createTestShareLink(db, 'tok', board, 'VIEW');

      const result = await redeemShareLink(db, 'tok', caller('redeemer', 'r@example.com'));

      expect(result?.role).toBe('EDIT');
      const [member] = await listMembers(board);
      expect(member?.role).toBe('EDIT');
      expect(await memberRoles(board)).toEqual({ redeemer: 'EDIT' });
    });

    it('claims a pending invite addressed to the verified caller instead of creating a second row', async () => {
      await createTestUser(db, 'owner', 'owner@example.com');
      await createTestUser(db, 'redeemer', 'r@example.com');
      const board = await createTestBoard(db, 'owner');
      await createTestMembership(db, board, {
        invitedEmail: 'r@example.com',
        role: 'EDIT',
        status: 'PENDING',
      });
      await createTestShareLink(db, 'tok', board, 'VIEW');

      const result = await redeemShareLink(db, 'tok', caller('redeemer', 'r@example.com'));

      // Matching only on userId could not see a row keyed by invitedEmail, so redemption
      // wrote a duplicate the owner could never fully remove.
      expect(await listMembers(board)).toHaveLength(1);
      expect(result?.role).toBe('EDIT');
      expect(await memberRoles(board)).toEqual({ redeemer: 'EDIT' });
    });

    it('ignores a pending invite when the caller has not verified that address', async () => {
      await createTestUser(db, 'owner', 'owner@example.com');
      await createTestUser(db, 'redeemer', 'r@example.com', null, false);
      const board = await createTestBoard(db, 'owner');
      await createTestMembership(db, board, {
        invitedEmail: 'r@example.com',
        role: 'EDIT',
        status: 'PENDING',
      });
      await createTestShareLink(db, 'tok', board, 'VIEW');

      const result = await redeemShareLink(db, 'tok', caller('redeemer', 'r@example.com', false));

      // Claiming it on an unverified claim would let an attacker inherit the victim's
      // invited role just by redeeming a link of their own.
      expect(result?.role).toBe('VIEW');
      const rows = await listMembers(board);
      expect(rows.find((row) => row.status === 'PENDING')?.role).toBe('EDIT');
      expect(await memberRoles(board)).toEqual({ redeemer: 'VIEW' });
    });

    it('never claims a row already linked to a different user', async () => {
      await createTestUser(db, 'owner', 'owner@example.com');
      await createTestUser(db, 'redeemer', 'r@example.com');
      const board = await createTestBoard(db, 'owner');
      // The legacy shape: activation used to leave invitedEmail populated next to a uid.
      await createTestMembership(db, board, {
        userId: 'someone-else',
        invitedEmail: 'r@example.com',
        role: 'EDIT',
        status: 'ACTIVE',
      });
      await createTestShareLink(db, 'tok', board, 'VIEW');

      const result = await redeemShareLink(db, 'tok', caller('redeemer', 'r@example.com'));

      // Matching on the address alone would hand this caller another user's membership.
      expect(result?.role).toBe('VIEW');
      expect(await listMembers(board)).toHaveLength(2);
      expect(await memberRoles(board)).toEqual({ redeemer: 'VIEW' });
    });
  });
});
