import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  createTestBoard,
  createTestDatabase,
  createTestUser,
  resetDatabase,
  addTestMember,
  type TestDatabase,
} from './helpers.js';
import {
  connectAccount,
  revokeConnection,
  requireConnection,
  authorizeConnectionBoard,
} from '../src/lib/mcp/grants.js';
import type { Database } from '../src/lib/postgres/client.js';
import { boardMembers } from '../src/lib/postgres/schema/index.js';

let handle: TestDatabase;
let db: Database;
const actor = { id: 'owner', email: 'owner@example.com', emailVerified: true };
beforeAll(async () => {
  handle = await createTestDatabase();
  db = handle.db;
});
beforeEach(async () => {
  await resetDatabase(db);
  await createTestUser(db, actor.id, actor.email);
  await createTestBoard(db, actor.id);
});
afterAll(async () => {
  await handle?.drop();
});
describe('account-wide OAuth connections', () => {
  const token = {
    clientId: 'new-client',
    issuedAt: Math.floor(Date.now() / 1000) + 2,
    scopes: ['wally:read', 'wally:write'],
  };
  it('creates one connection concurrently and inherits live board roles', async () => {
    const grants = await Promise.all([
      requireConnection(db, actor.id, token, true),
      requireConnection(db, actor.id, token, true),
    ]);
    expect(grants[0].id).toBe(grants[1].id);
    await authorizeConnectionBoard(db, actor, grants[0].id, 'owner', true, true);
    await createTestUser(db, 'second', 'second@example.com');
    await createTestBoard(db, 'second');
    await addTestMember(db, 'second', actor.id, 'VIEW');
    await authorizeConnectionBoard(db, actor, grants[0].id, 'second', false, true);
    await expect(
      authorizeConnectionBoard(db, actor, grants[0].id, 'second', true, true),
    ).rejects.toMatchObject({ statusCode: 403 });
    // The membership ends: the connection inherits no role on the board any more.
    await db
      .delete(boardMembers)
      .where(and(eq(boardMembers.boardId, 'second'), eq(boardMembers.userId, actor.id)));
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
