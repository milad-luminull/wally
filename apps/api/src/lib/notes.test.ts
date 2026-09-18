import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getTestPrisma, resetDatabase } from '../../test/helpers.js';
import { assertValidAssignee, computeMoveUpdate } from './notes.js';
import { AppError } from './errors.js';

describe('computeMoveUpdate', () => {
  const base = { horizon: 'HEUTE' as const, priority: 'MITTEL' as const, freeX: 10, freeY: 20 };

  it('HORIZON mode writes only horizon, leaving priority/freeX/freeY untouched', () => {
    const { data, metadata } = computeMoveUpdate(base, { mode: 'HORIZON', horizon: 'SPAETER' });
    expect(data).toEqual({ horizon: 'SPAETER' });
    expect(data).not.toHaveProperty('priority');
    expect(data).not.toHaveProperty('freeX');
    expect(data).not.toHaveProperty('freeY');
    expect(metadata).toEqual({ mode: 'HORIZON', from: 'HEUTE', to: 'SPAETER' });
  });

  it('PRIORITY mode writes only priority, leaving horizon/freeX/freeY untouched', () => {
    const { data, metadata } = computeMoveUpdate(base, { mode: 'PRIORITY', priority: 'HOCH' });
    expect(data).toEqual({ priority: 'HOCH' });
    expect(data).not.toHaveProperty('horizon');
    expect(data).not.toHaveProperty('freeX');
    expect(data).not.toHaveProperty('freeY');
    expect(metadata).toEqual({ mode: 'PRIORITY', from: 'MITTEL', to: 'HOCH' });
  });

  it('FREE mode writes only freeX/freeY, leaving horizon/priority untouched', () => {
    const { data, metadata } = computeMoveUpdate(base, { mode: 'FREE', x: 111, y: 222 });
    expect(data).toEqual({ freeX: 111, freeY: 222 });
    expect(data).not.toHaveProperty('horizon');
    expect(data).not.toHaveProperty('priority');
    expect(metadata).toEqual({
      mode: 'FREE',
      from: { x: 10, y: 20 },
      to: { x: 111, y: 222 },
    });
  });
});

describe('assertValidAssignee', () => {
  const prisma = getTestPrisma();

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await prisma.$disconnect();
  });

  async function makeBoardWithMembers() {
    const owner = await prisma.user.create({
      data: { id: 'u-owner', email: 'owner@finlex.de' },
    });
    const activeEditor = await prisma.user.create({
      data: { id: 'u-editor', email: 'editor@finlex.de' },
    });
    const pendingUser = await prisma.user.create({
      data: { id: 'u-pending', email: 'pending@finlex.de' },
    });
    const outsider = await prisma.user.create({
      data: { id: 'u-outsider', email: 'outsider@finlex.de' },
    });
    const board = await prisma.whiteboard.create({ data: { ownerId: owner.id } });
    await prisma.whiteboardMember.create({
      data: { whiteboardId: board.id, userId: activeEditor.id, role: 'EDIT', status: 'ACTIVE' },
    });
    await prisma.whiteboardMember.create({
      data: { whiteboardId: board.id, userId: pendingUser.id, role: 'VIEW', status: 'PENDING' },
    });
    return { owner, activeEditor, pendingUser, outsider, board };
  }

  it('allows null (unassign)', async () => {
    const { board } = await makeBoardWithMembers();
    await expect(assertValidAssignee(prisma, board.id, null)).resolves.toBeUndefined();
  });

  it('allows the board owner', async () => {
    const { board, owner } = await makeBoardWithMembers();
    await expect(assertValidAssignee(prisma, board.id, owner.id)).resolves.toBeUndefined();
  });

  it('allows an ACTIVE member', async () => {
    const { board, activeEditor } = await makeBoardWithMembers();
    await expect(assertValidAssignee(prisma, board.id, activeEditor.id)).resolves.toBeUndefined();
  });

  it('rejects a PENDING member', async () => {
    const { board, pendingUser } = await makeBoardWithMembers();
    await expect(assertValidAssignee(prisma, board.id, pendingUser.id)).rejects.toThrow(AppError);
  });

  it('rejects a non-member', async () => {
    const { board, outsider } = await makeBoardWithMembers();
    await expect(assertValidAssignee(prisma, board.id, outsider.id)).rejects.toThrow(AppError);
  });
});
