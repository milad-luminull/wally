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
