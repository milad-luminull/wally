import { beforeEach, describe, expect, it } from 'vitest';
import {
  createTestBoard,
  createTestMembership,
  createTestUser,
  getTestDb,
  resetDatabase,
} from '../../test/helpers.js';
import { Timestamp } from 'firebase-admin/firestore';
import { whiteboardsCol } from './db/collections.js';
import { getEffectiveRole } from './authorization.js';

const PROJECT_ID = 'wally-test-authorization';

describe('getEffectiveRole', () => {
  const db = getTestDb(PROJECT_ID);

  beforeEach(async () => {
    await resetDatabase(PROJECT_ID);
  });

  async function makeFixture() {
    await createTestUser(db, 'u-owner', 'owner@example.com');
    await createTestUser(db, 'u-edit', 'edit@example.com');
    await createTestUser(db, 'u-view', 'view@example.com');
    await createTestUser(db, 'u-pending', 'pending@example.com');
    await createTestUser(db, 'u-stranger', 'stranger@example.com');

    // Only ACTIVE memberships appear in memberRoles — that is exactly the distinction
    // this function is being asked about.
    const board = await createTestBoard(db, 'u-owner', { 'u-edit': 'EDIT', 'u-view': 'VIEW' });
    await createTestMembership(db, board, { userId: 'u-edit', role: 'EDIT', status: 'ACTIVE' });
    await createTestMembership(db, board, { userId: 'u-view', role: 'VIEW', status: 'ACTIVE' });
    await createTestMembership(db, board, { userId: 'u-pending', role: 'EDIT', status: 'PENDING' });
    return { board };
  }

  it('returns OWNER for the board owner', async () => {
    const { board } = await makeFixture();
    await expect(getEffectiveRole(db, 'u-owner', board)).resolves.toBe('OWNER');
  });

  it('returns EDIT for an active EDIT member', async () => {
    const { board } = await makeFixture();
    await expect(getEffectiveRole(db, 'u-edit', board)).resolves.toBe('EDIT');
  });

  it('returns VIEW for an active VIEW member', async () => {
    const { board } = await makeFixture();
    await expect(getEffectiveRole(db, 'u-view', board)).resolves.toBe('VIEW');
  });

  it('returns null for a PENDING member (not yet active)', async () => {
    const { board } = await makeFixture();
    await expect(getEffectiveRole(db, 'u-pending', board)).resolves.toBeNull();
  });

  it('returns null for a non-member', async () => {
    const { board } = await makeFixture();
    await expect(getEffectiveRole(db, 'u-stranger', board)).resolves.toBeNull();
  });

  it('returns null for a tombstoned whiteboard, even for its owner', async () => {
    const { board } = await makeFixture();
    await whiteboardsCol(db).doc(board).update({ deletedAt: Timestamp.now() });
    await expect(getEffectiveRole(db, 'u-owner', board)).resolves.toBeNull();
  });

  it('returns null for a nonexistent whiteboard', async () => {
    await makeFixture();
    await expect(getEffectiveRole(db, 'u-stranger', 'does-not-exist')).resolves.toBeNull();
  });
});
