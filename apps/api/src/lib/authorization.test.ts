import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getTestPrisma, resetDatabase } from '../../test/helpers.js';
import { getEffectiveRole } from './authorization.js';

describe('getEffectiveRole', () => {
  const prisma = getTestPrisma();

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await prisma.$disconnect();
  });

  async function makeFixture() {
    const owner = await prisma.user.create({ data: { id: 'u-owner', email: 'owner@finlex.de' } });
    const editUser = await prisma.user.create({ data: { id: 'u-edit', email: 'edit@finlex.de' } });
    const viewUser = await prisma.user.create({ data: { id: 'u-view', email: 'view@finlex.de' } });
    const pendingUser = await prisma.user.create({
      data: { id: 'u-pending', email: 'pending@finlex.de' },
    });
    const strangerUser = await prisma.user.create({
      data: { id: 'u-stranger', email: 'stranger@finlex.de' },
    });
    const board = await prisma.whiteboard.create({ data: { ownerId: owner.id } });
    await prisma.whiteboardMember.create({
      data: { whiteboardId: board.id, userId: editUser.id, role: 'EDIT', status: 'ACTIVE' },
    });
    await prisma.whiteboardMember.create({
      data: { whiteboardId: board.id, userId: viewUser.id, role: 'VIEW', status: 'ACTIVE' },
    });
    await prisma.whiteboardMember.create({
      data: { whiteboardId: board.id, userId: pendingUser.id, role: 'EDIT', status: 'PENDING' },
    });
    return { owner, editUser, viewUser, pendingUser, strangerUser, board };
  }

  it('returns OWNER for the board owner', async () => {
    const { board, owner } = await makeFixture();
    await expect(getEffectiveRole(prisma, owner.id, board.id)).resolves.toBe('OWNER');
  });

  it('returns EDIT for an active EDIT member', async () => {
    const { board, editUser } = await makeFixture();
    await expect(getEffectiveRole(prisma, editUser.id, board.id)).resolves.toBe('EDIT');
  });

  it('returns VIEW for an active VIEW member', async () => {
    const { board, viewUser } = await makeFixture();
    await expect(getEffectiveRole(prisma, viewUser.id, board.id)).resolves.toBe('VIEW');
  });

  it('returns null for a PENDING member (not yet active)', async () => {
    const { board, pendingUser } = await makeFixture();
    await expect(getEffectiveRole(prisma, pendingUser.id, board.id)).resolves.toBeNull();
  });

  it('returns null for a non-member', async () => {
    const { board, strangerUser } = await makeFixture();
    await expect(getEffectiveRole(prisma, strangerUser.id, board.id)).resolves.toBeNull();
  });

  it('returns null for a nonexistent whiteboard', async () => {
    const { strangerUser } = await makeFixture();
    await expect(getEffectiveRole(prisma, strangerUser.id, 'does-not-exist')).resolves.toBeNull();
  });
});
