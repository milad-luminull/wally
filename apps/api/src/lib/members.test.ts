import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getTestPrisma, resetDatabase } from '../../test/helpers.js';
import { activatePendingInvitesForEmail, redeemShareLink, upsertInvite } from './members.js';

describe('members business logic', () => {
  const prisma = getTestPrisma();

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await prisma.$disconnect();
  });

  describe('upsertInvite', () => {
    it('creates a PENDING row when no User exists for that email', async () => {
      const owner = await prisma.user.create({ data: { id: 'owner', email: 'owner@finlex.de' } });
      const board = await prisma.whiteboard.create({ data: { ownerId: owner.id } });

      const member = await upsertInvite(prisma, board.id, 'new-person@finlex.de', 'VIEW');

      expect(member.status).toBe('PENDING');
      expect(member.userId).toBeNull();
      expect(member.invitedEmail).toBe('new-person@finlex.de');
      expect(member.role).toBe('VIEW');
    });

    it('creates an ACTIVE row immediately when a User already exists for that email', async () => {
      const owner = await prisma.user.create({ data: { id: 'owner', email: 'owner@finlex.de' } });
      const existingUser = await prisma.user.create({
        data: { id: 'existing', email: 'existing@finlex.de' },
      });
      const board = await prisma.whiteboard.create({ data: { ownerId: owner.id } });

      const member = await upsertInvite(prisma, board.id, 'existing@finlex.de', 'EDIT');

      expect(member.status).toBe('ACTIVE');
      expect(member.userId).toBe(existingUser.id);
      expect(member.activatedAt).not.toBeNull();
    });

    it('re-inviting updates the role of an existing row instead of erroring', async () => {
      const owner = await prisma.user.create({ data: { id: 'owner', email: 'owner@finlex.de' } });
      const board = await prisma.whiteboard.create({ data: { ownerId: owner.id } });

      await upsertInvite(prisma, board.id, 'person@finlex.de', 'VIEW');
      const updated = await upsertInvite(prisma, board.id, 'person@finlex.de', 'EDIT');

      const all = await prisma.whiteboardMember.findMany({ where: { whiteboardId: board.id } });
      expect(all).toHaveLength(1);
      expect(updated.role).toBe('EDIT');
    });

    it('links a pending invite by invitedEmail once the User record shows up', async () => {
      const owner = await prisma.user.create({ data: { id: 'owner', email: 'owner@finlex.de' } });
      const board = await prisma.whiteboard.create({ data: { ownerId: owner.id } });

      await upsertInvite(prisma, board.id, 'later-signup@finlex.de', 'VIEW');
      const laterUser = await prisma.user.create({
        data: { id: 'later', email: 'later-signup@finlex.de' },
      });

      const updated = await upsertInvite(prisma, board.id, 'later-signup@finlex.de', 'EDIT');

      expect(updated.status).toBe('ACTIVE');
      expect(updated.userId).toBe(laterUser.id);
      expect(updated.invitedEmail).toBeNull();
      const all = await prisma.whiteboardMember.findMany({ where: { whiteboardId: board.id } });
      expect(all).toHaveLength(1);
    });
  });

  describe('activatePendingInvitesForEmail', () => {
    it('activates a PENDING row with a case-insensitive email match', async () => {
      const owner = await prisma.user.create({ data: { id: 'owner', email: 'owner@finlex.de' } });
      const board = await prisma.whiteboard.create({ data: { ownerId: owner.id } });
      await prisma.whiteboardMember.create({
        data: {
          whiteboardId: board.id,
          invitedEmail: 'invitee@finlex.de',
          role: 'VIEW',
          status: 'PENDING',
        },
      });
      // WhiteboardMember.userId is a real FK — in production this function only ever runs
      // after the auth hook has already upserted the User row for this id (see
      // src/plugins/auth.ts), so the fixture here does the same.
      await prisma.user.create({ data: { id: 'new-user-id', email: 'invitee@finlex.de' } });

      const count = await activatePendingInvitesForEmail(prisma, 'new-user-id', 'INVITEE@Finlex.de');

      expect(count).toBe(1);
      const member = await prisma.whiteboardMember.findFirst({ where: { whiteboardId: board.id } });
      expect(member?.status).toBe('ACTIVE');
      expect(member?.userId).toBe('new-user-id');
      expect(member?.activatedAt).not.toBeNull();
    });

    it('does nothing when there is no matching pending invite', async () => {
      const count = await activatePendingInvitesForEmail(prisma, 'new-user-id', 'nobody@finlex.de');
      expect(count).toBe(0);
    });
  });

  describe('redeemShareLink', () => {
    it('returns null for an invalid token', async () => {
      await expect(redeemShareLink(prisma, 'nonexistent-token', 'some-user')).resolves.toBeNull();
    });

    it('is a no-op when the owner redeems their own link', async () => {
      const owner = await prisma.user.create({ data: { id: 'owner', email: 'owner@finlex.de' } });
      const board = await prisma.whiteboard.create({ data: { ownerId: owner.id } });
      await prisma.shareLink.create({ data: { whiteboardId: board.id, token: 'tok', role: 'EDIT' } });

      const result = await redeemShareLink(prisma, 'tok', owner.id);

      expect(result).toEqual({ whiteboardId: board.id, role: 'EDIT' });
      const members = await prisma.whiteboardMember.findMany({ where: { whiteboardId: board.id } });
      expect(members).toHaveLength(0);
    });

    it('creates a new ACTIVE membership at the link role for a first-time redeemer', async () => {
      const owner = await prisma.user.create({ data: { id: 'owner', email: 'owner@finlex.de' } });
      const redeemer = await prisma.user.create({ data: { id: 'redeemer', email: 'r@finlex.de' } });
      const board = await prisma.whiteboard.create({ data: { ownerId: owner.id } });
      await prisma.shareLink.create({ data: { whiteboardId: board.id, token: 'tok', role: 'VIEW' } });

      const result = await redeemShareLink(prisma, 'tok', redeemer.id);

      expect(result).toEqual({ whiteboardId: board.id, role: 'VIEW' });
      const member = await prisma.whiteboardMember.findFirst({
        where: { whiteboardId: board.id, userId: redeemer.id },
      });
      expect(member?.status).toBe('ACTIVE');
      expect(member?.role).toBe('VIEW');
    });

    it('upgrades an existing VIEW membership when redeeming an EDIT link', async () => {
      const owner = await prisma.user.create({ data: { id: 'owner', email: 'owner@finlex.de' } });
      const redeemer = await prisma.user.create({ data: { id: 'redeemer', email: 'r@finlex.de' } });
      const board = await prisma.whiteboard.create({ data: { ownerId: owner.id } });
      await prisma.whiteboardMember.create({
        data: { whiteboardId: board.id, userId: redeemer.id, role: 'VIEW', status: 'ACTIVE' },
      });
      await prisma.shareLink.create({ data: { whiteboardId: board.id, token: 'tok', role: 'EDIT' } });

      const result = await redeemShareLink(prisma, 'tok', redeemer.id);

      expect(result?.role).toBe('EDIT');
    });

    it('never downgrades an existing EDIT membership when redeeming a VIEW link', async () => {
      const owner = await prisma.user.create({ data: { id: 'owner', email: 'owner@finlex.de' } });
      const redeemer = await prisma.user.create({ data: { id: 'redeemer', email: 'r@finlex.de' } });
      const board = await prisma.whiteboard.create({ data: { ownerId: owner.id } });
      await prisma.whiteboardMember.create({
        data: { whiteboardId: board.id, userId: redeemer.id, role: 'EDIT', status: 'ACTIVE' },
      });
      await prisma.shareLink.create({ data: { whiteboardId: board.id, token: 'tok', role: 'VIEW' } });

      const result = await redeemShareLink(prisma, 'tok', redeemer.id);

      expect(result?.role).toBe('EDIT');
      const member = await prisma.whiteboardMember.findFirst({
        where: { whiteboardId: board.id, userId: redeemer.id },
      });
      expect(member?.role).toBe('EDIT');
    });
  });
});
