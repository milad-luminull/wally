import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestBoard,
  createTestUser,
  getTestDb,
  resetDatabase,
  addTestMember,
} from './helpers.js';
import {
  createConnection,
  connectAccount,
  revokeConnection,
  requireConnection,
  setBoardPolicy,
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
describe('MCP connection grants', () => {
  it('requires explicit board owner permission before any grant', async () => {
    await expect(
      createConnection(db, actor, 'chatgpt-client', ['owner'], false),
    ).rejects.toMatchObject({ code: 'MCP_BOARD_DISABLED' });
    await setBoardPolicy(db, actor, 'owner', true);
    const grant = await createConnection(db, actor, 'chatgpt-client', ['owner'], false);
    expect(grant.scopes).toEqual(['wally:read']);
  });
  it('denies members the ability to enable external access', async () => {
    await addTestMember(db, 'owner', 'editor', 'EDIT');
    await expect(
      setBoardPolicy(db, { ...actor, id: 'editor' }, 'owner', true),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it('rejects old tokens and wrong clients and revokes existing tokens on the next call', async () => {
    await setBoardPolicy(db, actor, 'owner', true);
    const grant = await createConnection(db, actor, 'chatgpt-client', ['owner'], false);
    const token = {
      clientId: 'chatgpt-client',
      issuedAt: grant.issuedAfter + 1,
      scopes: ['wally:read'],
    };
    expect((await requireConnection(db, actor.id, token)).id).toBe(grant.id);
    await expect(
      requireConnection(db, actor.id, { ...token, issuedAt: grant.issuedAfter }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      requireConnection(db, actor.id, { ...token, clientId: 'foreign' }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await revokeConnection(db, actor.id, grant.id);
    await revokeConnection(db, actor.id, grant.id);
    await expect(requireConnection(db, actor.id, token)).rejects.toMatchObject({
      code: 'MCP_CONSENT_REQUIRED',
    });
  });
  it('rechecks owner policy and current role on every board call', async () => {
    await setBoardPolicy(db, actor, 'owner', true);
    const grant = await createConnection(db, actor, 'chatgpt-client', ['owner'], true);
    await authorizeConnectionBoard(db, actor, grant.id, 'owner', true, true);
    await setBoardPolicy(db, actor, 'owner', false);
    await expect(
      authorizeConnectionBoard(db, actor, grant.id, 'owner', false, true),
    ).rejects.toMatchObject({ code: 'MCP_BOARD_DISABLED' });
  });
  it('cannot revoke another user’s connection or broaden a read-only grant', async () => {
    await setBoardPolicy(db, actor, 'owner', true);
    const grant = await createConnection(db, actor, 'chatgpt-client', ['owner'], false);
    await expect(revokeConnection(db, 'other', grant.id)).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(
      authorizeConnectionBoard(db, actor, grant.id, 'owner', true, true),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      authorizeConnectionBoard(db, actor, grant.id, 'owner', false, false),
    ).rejects.toMatchObject({ statusCode: 503 });
  });
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
    expect(grants[0].access).toBe('all');
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
  it('does not expand a legacy connection automatically', async () => {
    await setBoardPolicy(db, actor, 'owner', true);
    const old = await createConnection(db, actor, token.clientId, ['owner'], false);
    const result = await requireConnection(
      db,
      actor.id,
      { ...token, issuedAt: old.issuedAfter + 1 },
      true,
    );
    expect(result.access).not.toBe('all');
    expect(result.scopes).toEqual(['wally:read']);
    expect(result.boardIds).toEqual(['owner']);
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
