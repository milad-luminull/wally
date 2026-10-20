import { generateKeyPair, SignJWT } from 'jose';
import { createAuth0Verifier } from '../src/lib/auth/auth0.js';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as grants from '../src/lib/mcp/grants.js';
import { AppError } from '../src/lib/errors.js';
import { buildApp } from '../src/app.js';
import { createTestUser, getTestDb, resetDatabase } from './helpers.js';
import { bindImportedIdentity } from '../src/lib/auth/identities.js';
import { createConnection, revokeConnection, setBoardPolicy } from '../src/lib/mcp/grants.js';
import { runMcpTool, type McpToolContext } from '../src/lib/mcp/tools.js';
import {
  authorizeConnectionBoard,
  authorizeConnectionBoardInTransaction,
} from '../src/lib/mcp/grants.js';
import { consumeMcpWriteBudget } from '../src/lib/mcp/rate.js';
import { notesCol, now, whiteboardsCol } from '../src/lib/db/collections.js';
import { MCP_METADATA_PATH, MCP_RESOURCE, type McpRouteOptions } from '../src/routes/mcp.js';
import type { VerifiedIdentity } from '../src/lib/auth/auth0.js';
const projectId = 'wally-mcp-http';
const db = getTestDb(projectId);
let apps: FastifyInstance[];
let identity: VerifiedIdentity;
let grantId: string;
const actor = { id: 'owner', email: 'owner@example.com', emailVerified: true };
const headers = {
  authorization: 'Bearer mcp-token',
  accept: 'application/json, text/event-stream',
  'mcp-protocol-version': '2025-11-25',
};
async function makeApp(overrides: McpRouteOptions = {}) {
  const app = await buildApp({
    db,
    logger: false,
    authVerifier: {
      async verifyIdToken() {
        throw new Error('REST verifier must not handle MCP');
      },
    },
    mcp: {
      enabled: true,
      assistantEnabled: true,
      writesEnabled: true,
      clientId: 'chatgpt',
      verifier: {
        async verify(token) {
          if (token !== 'mcp-token') throw new Error('token contents must never appear');
          return identity;
        },
      },
      ...overrides,
    },
  });
  await app.ready();
  apps.push(app);
  return app;
}
const rpc = (app: FastifyInstance, method: string, params: unknown = {}, extraHeaders = {}) =>
  app.inject({
    method: 'POST',
    url: '/mcp',
    headers: { ...headers, ...extraHeaders },
    payload: { jsonrpc: '2.0', id: 1, method, params },
  });
const call = (app: FastifyInstance, name: string, args: unknown) =>
  rpc(app, 'tools/call', { name, arguments: args });
beforeEach(async () => {
  apps = [];
  await resetDatabase(projectId);
  await createTestUser(db, actor.id, actor.email);
  const timestamp = now();
  await whiteboardsCol(db).doc('board').set({
    name: 'Board',
    ownerId: actor.id,
    revision: 1,
    memberRoles: {},
    shareLinkToken: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  identity = {
    issuer: 'https://login.luminull.com/',
    subject: 'auth0|owner',
    email: actor.email,
    emailVerified: true,
    name: 'Owner',
    clientId: 'chatgpt',
    scopes: ['wally:read', 'wally:write'],
    issuedAt: Math.floor(Date.now() / 1000) + 2,
  };
  await bindImportedIdentity(db, identity, actor.id);
  await setBoardPolicy(db, actor, 'board', true);
  grantId = (await createConnection(db, actor, 'chatgpt', ['board'], true)).id;
});
afterEach(async () => {
  for (const app of apps) await app.close();
  vi.restoreAllMocks();
});
describe('stateless MCP HTTP boundary', () => {
  it('publishes resource discovery publicly and challenges without using REST auth', async () => {
    const app = await makeApp();
    const discovery = await app.inject({ method: 'GET', url: MCP_METADATA_PATH });
    expect(discovery.statusCode).toBe(200);
    expect(discovery.json()).toMatchObject({
      resource: MCP_RESOURCE,
      authorization_servers: ['https://login.luminull.com/'],
      scopes_supported: ['wally:read', 'wally:write'],
    });
    const denied = await app.inject({ method: 'POST', url: '/mcp', payload: {} });
    expect(denied.statusCode).toBe(401);
    expect(denied.headers['www-authenticate']).toContain(MCP_METADATA_PATH);
    expect(denied.headers['www-authenticate']).toContain('scope="wally:read"');
    const invalid = await rpc(app, 'tools/list', {}, { authorization: 'Bearer rest-token' });
    expect(invalid.statusCode).toBe(401);
    expect(invalid.body).not.toContain('token contents');
  });
  it('cryptographically rejects REST-audience, wrong-issuer and expired access tokens', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const verifier = createAuth0Verifier(
      { issuer: identity.issuer, audience: MCP_RESOURCE },
      async () => publicKey,
    );
    const app = await makeApp({ verifier });
    const signed = (audience: string, issuer = identity.issuer, expired = false) =>
      new SignJWT({
        azp: 'chatgpt',
        scope: 'wally:read',
        'https://wally.luminull.com/email': actor.email,
        'https://wally.luminull.com/email_verified': true,
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setSubject(identity.subject)
        .setIssuer(issuer)
        .setAudience(audience)
        .setIssuedAt(identity.issuedAt!)
        .setExpirationTime(expired ? 1 : Math.floor(Date.now() / 1000) + 600)
        .sign(privateKey);
    for (const token of [
      await signed('https://api.wally.luminull.com'),
      await signed(MCP_RESOURCE, 'https://evil.example/'),
      await signed(MCP_RESOURCE, identity.issuer, true),
    ])
      expect(
        (await rpc(app, 'tools/list', {}, { authorization: `Bearer ${token}` })).statusCode,
      ).toBe(401);
    const valid = await signed(MCP_RESOURCE);
    expect(
      (await rpc(app, 'tools/list', {}, { authorization: `Bearer ${valid}` })).json().result.tools,
    ).toHaveLength(5);
  });
  it('initializes without server sessions, lists bounded tools and supports lost-response retry across instances', async () => {
    const app = await makeApp();
    const init = await rpc(app, 'initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    expect(init.statusCode).toBe(200);
    expect(init.headers['mcp-session-id']).toBeUndefined();
    expect(init.json().result.serverInfo.name).toBe('wally');
    const listing = await rpc(app, 'tools/list');
    expect(listing.json().result.tools).toHaveLength(13);
    for (const tool of listing.json().result.tools) {
      const scopes = tool.annotations.readOnlyHint ? ['wally:read'] : ['wally:read', 'wally:write'];
      expect(tool.securitySchemes).toEqual([{ type: 'oauth2', scopes }]);
      expect(tool._meta.securitySchemes).toEqual(tool.securitySchemes);
    }
    const args = { boardId: 'board', operationId: randomUUID(), input: { title: 'Saved once' } };
    const first = await call(app, 'create_note', args);
    expect(first.json().result.isError).not.toBe(true);
    const secondApp = await makeApp();
    const replay = await call(secondApp, 'create_note', args);
    expect(replay.json()).toEqual(first.json());
    expect((await notesCol(db).get()).size).toBe(1);
    await revokeConnection(db, actor.id, grantId);
    expect((await call(secondApp, 'create_note', args)).statusCode).toBe(403);
  });
  it('signals tool-level reauthorization without returning protected data', async () => {
    const original = grants.requireConnection;
    let checked = false;
    vi.spyOn(grants, 'requireConnection').mockImplementation(async (...args) => {
      if (checked) throw new AppError(403, 'MCP_CONSENT_REQUIRED', 'Connection revoked');
      checked = true;
      return original(...args);
    });
    const response = await call(await makeApp(), 'get_board', { boardId: 'board' });
    expect(response.json().result.isError).toBe(true);
    const challenge = response.json().result._meta['mcp/www_authenticate'][0];
    expect(challenge).toContain('error="insufficient_scope"');
    expect(challenge).toContain('error_description=');
    expect(challenge).toContain('scope="wally:read"');
    expect(response.json().result.structuredContent).not.toHaveProperty('data');
  });
  it('enforces token client identity, scope, mapping and grant issuance fence', async () => {
    const app = await makeApp();
    identity.clientId = 'other';
    expect((await rpc(app, 'tools/list')).statusCode).toBe(401);
    identity.clientId = 'chatgpt';
    identity.scopes = [];
    expect((await rpc(app, 'tools/list')).statusCode).toBe(401);
    identity.scopes = ['wally:read'];
    identity.subject = 'unknown';
    expect((await rpc(app, 'tools/list')).statusCode).toBe(403);
    identity.subject = 'auth0|owner';
    identity.issuedAt = 1;
    expect((await rpc(app, 'tools/list')).statusCode).toBe(403);
  });
  it('rejects foreign origins, unsupported transport methods and malformed protocol versions', async () => {
    const app = await makeApp();
    expect((await rpc(app, 'tools/list', {}, { origin: 'https://evil.example' })).statusCode).toBe(
      403,
    );
    expect((await rpc(app, 'tools/list', {}, { origin: 'null' })).statusCode).toBe(403);
    expect((await rpc(app, 'tools/list', {}, { origin: 'https://chatgpt.com' })).statusCode).toBe(
      200,
    );
    for (const method of ['GET', 'DELETE'] as const)
      expect((await app.inject({ method, url: '/mcp', headers })).statusCode).toBe(405);
    expect((await rpc(app, 'tools/list', {}, { 'mcp-protocol-version': 'bogus' })).statusCode).toBe(
      400,
    );
  });
  it('honors deployment and board switches and withholds write tools for readonly connections', async () => {
    expect((await rpc(await makeApp({ enabled: false }), 'tools/list')).statusCode).toBe(503);
    expect((await rpc(await makeApp({ assistantEnabled: false }), 'tools/list')).statusCode).toBe(
      503,
    );
    const writesOff = await makeApp({ writesEnabled: false });
    expect((await rpc(writesOff, 'tools/list')).json().result.tools).toHaveLength(5);
    for (const app of [writesOff, await makeApp()]) {
      identity.scopes = ['wally:read'];
      expect((await rpc(app, 'tools/list')).json().result.tools).toHaveLength(5);
      const denied = await call(app, 'create_note', {
        boardId: 'board',
        operationId: randomUUID(),
        input: {},
      });
      expect(denied.json().result?.isError ?? Boolean(denied.json().error)).toBe(true);
    }
    await setBoardPolicy(db, actor, 'board', false);
    const disabled = await call(await makeApp(), 'get_board', { boardId: 'board' });
    expect(disabled.json().result.structuredContent.error).toBe('MCP_BOARD_DISABLED');
    expect((await notesCol(db).get()).size).toBe(0);
  });
  it.each(['revoke-new', 'revoke-replay', 'policy-new', 'policy-replay'])(
    'rechecks durable authorization inside the command transaction: %s',
    async (scenario) => {
      let interrupt = false;
      const context: McpToolContext = {
        db,
        actor,
        connectionId: grantId,
        scopes: ['wally:read', 'wally:write'],
        allowedBoardIds: ['board'],
        async authorizeBoard(boardId, write) {
          await authorizeConnectionBoard(db, actor, grantId, boardId, write, true);
          if (interrupt) {
            if (scenario.startsWith('revoke')) await revokeConnection(db, actor.id, grantId);
            else await setBoardPolicy(db, actor, boardId, false);
          }
        },
        authorizeWrite: (tx, boardId) =>
          authorizeConnectionBoardInTransaction(db, tx, actor, grantId, boardId, true, true),
      };
      const args = { boardId: 'board', operationId: randomUUID(), input: { title: 'Guarded' } };
      const replay = scenario.endsWith('replay');
      if (replay) await runMcpTool(context, 'create_note', args);
      interrupt = true;
      await expect(runMcpTool(context, 'create_note', args)).rejects.toMatchObject({
        code: scenario.startsWith('revoke') ? 'MCP_CONSENT_REQUIRED' : 'MCP_BOARD_DISABLED',
      });
      expect((await notesCol(db).get()).size).toBe(replay ? 1 : 0);
      expect((await db.collection('assistantAudit').get()).size).toBe(replay ? 1 : 0);
    },
  );
  it('keeps the production Auth0 switch mandatory without a verifier test override', async () => {
    const app = await makeApp({ verifier: undefined });
    expect((await rpc(app, 'tools/list')).statusCode).toBe(503);
  });
  it('shares write budgets across application instances and limits both user and connection', async () => {
    const a = await makeApp({ writeLimits: { user: 3, connection: 1 } });
    const b = await makeApp({ writeLimits: { user: 3, connection: 1 } });
    expect(
      (
        await call(a, 'create_note', { boardId: 'board', operationId: randomUUID(), input: {} })
      ).json().result.isError,
    ).not.toBe(true);
    expect(
      (
        await call(b, 'create_note', { boardId: 'board', operationId: randomUUID(), input: {} })
      ).json().result.structuredContent.error,
    ).toBe('RATE_LIMITED');
    await consumeMcpWriteBudget(db, 'separate-user', 'one', { user: 1, connection: 2 }, 100000);
    await expect(
      consumeMcpWriteBudget(db, 'separate-user', 'two', { user: 1, connection: 2 }, 100000),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(
      consumeMcpWriteBudget(db, 'separate-user', 'two', { user: 1, connection: 2 }, 180000),
    ).resolves.toBeUndefined();
    const counters = await db
      .collection('users')
      .doc('separate-user')
      .collection('mcpLimits')
      .get();
    expect(counters.size).toBe(1);
    expect(Object.keys(counters.docs[0]!.data().connections)).toHaveLength(1);
  });
});
