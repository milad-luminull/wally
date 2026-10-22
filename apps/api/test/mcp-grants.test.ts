import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestBoard,
  createTestUser,
  getTestDb,
  resetDatabase,
  addTestMember,
} from './helpers.js';
import {
  connectAccount,
  revokeConnection,
  requireConnection,
  authorizeConnectionBoard,
} from '../src/lib/mcp/grants.js';

const project = 'wally-test-mcp-grants';
const db = getTestDb(project);
const actor = { id: 'owner', email: 'owner@example.com', emailVerified: true };
beforeEach(async () => {
  await resetDatabase(project);
  await createTestUser(db, actor.id, actor.email);
  await createTestBoard(db, actor.id);
});
afterEach(async () => {
  await resetDatabase(project);
});
describe('account-wide OAuth connections', () => {
  const token = {
    clientId: 'new-client',
    issuedAt: Math.floor(Date.now() / 1000) + 2,
    scopes: ['wally:read', 'wally:write'],
  };
  it('creates one connection concurrently and inherits live board roles without owner AI switches', async () => {
    const grants = await Promise.all([
      requireConnection(db, actor.id, token, true),
      requireConnection(db, actor.id, token, true),
    ]);
    expect(grants[0].id).toBe(grants[1].id);
    await authorizeConnectionBoard(db, actor, grants[0].id, 'owner', true, true);
    await createTestBoard(db, 'second');
    await addTestMember(db, 'second', actor.id, 'VIEW');
    await authorizeConnectionBoard(db, actor, grants[0].id, 'second', false, true);
    await expect(
      authorizeConnectionBoard(db, actor, grants[0].id, 'second', true, true),
    ).rejects.toMatchObject({ statusCode: 403 });
    await db.collection('whiteboards').doc('second').update({ memberRoles: {} });
    await expect(
      authorizeConnectionBoard(db, actor, grants[0].id, 'second', false, true),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
  it('never silently reconnects a disconnected client, even with a refreshed token', async () => {
    const grant = await requireConnection(db, actor.id, token, true);
    await revokeConnection(db, actor.id, grant.id);
    await expect(requireConnection(db, actor.id, token, true)).rejects.toMatchObject({
      code: 'MCP_CONSENT_REQUIRED',
    });
    await expect(
      requireConnection(db, actor.id, { ...token, issuedAt: token.issuedAt + 1000 }, true),
    ).rejects.toMatchObject({ code: 'MCP_CONSENT_REQUIRED' });
  });
});

it('explicit reconnect rejects pre-reconnect tokens and respects OAuth scopes', async () => {
  const token = { clientId: 'reconnect-client', issuedAt: 1, scopes: ['wally:read'] };
  const original = await requireConnection(db, actor.id, token, true);
  await revokeConnection(db, actor.id, original.id);
  const reconnected = await connectAccount(db, actor.id, token.clientId);
  await expect(requireConnection(db, actor.id, token, true)).rejects.toMatchObject({
    code: 'MCP_CONSENT_REQUIRED',
  });
  const accepted = await requireConnection(
    db,
    actor.id,
    { ...token, issuedAt: reconnected.issuedAfter + 1 },
    true,
  );
  expect(accepted.scopes).toEqual(['wally:read']);
  expect(accepted.id).not.toBe(original.id);
});

it('cannot revoke another user connection or use a disabled deployment', async () => {
  const grant = await connectAccount(db, actor.id, 'client');
  await expect(revokeConnection(db, 'other', grant.id)).rejects.toMatchObject({ statusCode: 404 });
  await expect(
    authorizeConnectionBoard(db, actor, grant.id, 'owner', false, false),
  ).rejects.toMatchObject({ statusCode: 503 });
});
