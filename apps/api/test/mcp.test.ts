import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema, ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { generateKeyPair, SignJWT } from 'jose';
import { _resetEnvCacheForTests } from '../src/env.js';
import { createAuth0Verifier } from '../src/lib/auth/auth0.js';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as grants from '../src/lib/mcp/grants.js';
import { AppError } from '../src/lib/errors.js';
import { buildApp } from '../src/app.js';
import { createTestUser, getTestDb, resetDatabase } from './helpers.js';
import { bindKnownIdentity } from '../src/lib/auth/identities.js';
import { connectAccount, revokeConnection } from '../src/lib/mcp/grants.js';
import { runMcpTool, type McpToolContext } from '../src/lib/mcp/tools.js';
import {
  authorizeConnectionBoard,
  authorizeConnectionBoardInTransaction,
} from '../src/lib/mcp/grants.js';
import { consumeMcpWriteBudget } from '../src/lib/mcp/rate.js';
import { notesCol, now, whiteboardsCol } from '../src/lib/db/collections.js';
import { MCP_RESOURCE } from '../src/lib/auth/constants.js';
import { MCP_METADATA_PATH, type McpRouteOptions } from '../src/routes/mcp.js';
import type { VerifiedIdentity } from '../src/lib/auth/auth0.js';
/** The horizon's spelling from before ADR-0024, refused like any unknown value. */
const OLD = { horizon: 'SPAETER' } as const;
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
  await bindKnownIdentity(db, identity, actor.id);
  grantId = (await connectAccount(db, actor.id, 'chatgpt')).id;
});
afterEach(async () => {
  for (const app of apps) await app.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  _resetEnvCacheForTests();
});
describe('stateless MCP HTTP boundary', () => {
  it('shares the authenticated request budget across instances and blocks reads before execution', async () => {
    const options = { requestLimits: { user: 2, connection: 2 } };
    const first = await makeApp(options);
    const second = await makeApp(options);
    expect(
      (await rpc(first, 'tools/list', {}, { authorization: 'Bearer invalid' })).statusCode,
    ).toBe(401);
    expect((await call(first, 'list_notes', { boardId: 'board', limit: 1 })).statusCode).toBe(200);
    expect((await rpc(second, 'tools/list')).statusCode).toBe(200);
    const denied = await call(first, 'show_cards', { boardId: 'board', limit: 1 });
    expect(denied.statusCode).toBe(429);
    expect(denied.json().error).toBe('RATE_LIMITED');
    expect(denied.headers['retry-after']).toBe('60');
    expect((await notesCol(db).get()).size).toBe(0);
  });

  it('connects from OAuth alone, dynamically inherits boards and preserves write/replay authorization', async () => {
    await db.collection('users').doc(actor.id).collection('mcpConnections').doc(grantId).delete();
    await whiteboardsCol(db).doc('board').update({ assistantDisabled: true });
    const app = await makeApp();
    const listed = (await call(app, 'list_boards', {})).json().result;
    expect(listed.structuredContent.data.map((board: { id: string }) => board.id)).toEqual([
      'board',
    ]);
    const auto = (await db.collection('users').doc(actor.id).collection('mcpConnections').get())
      .docs[0]!;
    const args = {
      boardId: 'board',
      operationId: randomUUID(),
      input: { title: 'Inherited permissions' },
    };
    const created = (await call(app, 'create_note', args)).json().result;
    expect(created.isError).not.toBe(true);
    expect((await call(app, 'create_note', args)).json().result).toEqual(created);
    expect((await notesCol(db).get()).size).toBe(1);
    const board = (await whiteboardsCol(db).doc('board').get()).data()!;
    await whiteboardsCol(db)
      .doc('new-board')
      .set({ ...board, name: 'New board' });
    expect((await call(app, 'list_boards', {})).json().result.structuredContent.data).toHaveLength(
      2,
    );
    await whiteboardsCol(db)
      .doc('board')
      .update({ ownerId: 'someone-else', memberRoles: { [actor.id]: 'VIEW' } });
    expect((await call(app, 'get_board', { boardId: 'board' })).json().result.isError).not.toBe(
      true,
    );
    expect((await call(app, 'create_note', args)).json().result.isError).toBe(true);
    await whiteboardsCol(db).doc('board').update({ memberRoles: {} });
    expect((await call(app, 'get_board', { boardId: 'board' })).json().result.isError).toBe(true);
    await revokeConnection(db, actor.id, auto.id);
    identity.issuedAt! += 100;
    expect((await rpc(app, 'tools/list')).statusCode).toBe(403);
  });
  it('serves authorized card views and a self-contained UI resource without changing notes', async () => {
    const app = await makeApp();
    const created = (
      await call(app, 'create_note', {
        boardId: 'board',
        operationId: randomUUID(),
        input: { title: '<script>unsafe</script>', description: 'A card' },
      })
    ).json().result.structuredContent;
    const card = (
      await call(app, 'show_card', { boardId: 'board', noteId: created.data.id })
    ).json().result;
    expect(card.isError, JSON.stringify(card)).not.toBe(true);
    expect(card.structuredContent).toMatchObject({
      view: 'card',
      board: { id: 'board', name: 'Board' },
      total: 1,
      cards: [{ id: created.data.id, title: '<script>unsafe</script>', revision: 1 }],
    });
    const url = new URL(card.structuredContent.cards[0].url);
    expect(url.pathname).toBe('/boards/board');
    expect(url.searchParams.get('note')).toBe(created.data.id);
    const list = (await call(app, 'show_cards', { boardId: 'board' })).json().result;
    expect(list.structuredContent).toMatchObject({ view: 'list', total: 1, nextCursor: null });
    expect(list.structuredContent.cards).toHaveLength(1);
    const denied = (await call(app, 'show_cards', { boardId: 'not-a-member' })).json().result;
    expect(denied).toMatchObject({ isError: true });
    expect(denied.structuredContent).toBeUndefined();
    const listed = (await rpc(app, 'tools/list')).json().result.tools;
    const display = listed.find((tool: { name: string }) => tool.name === 'show_card');
    expect(display.outputSchema).toMatchObject({ type: 'object' });
    const uri = display._meta.ui.resourceUri;
    const resources = (await rpc(app, 'resources/list')).json().result.resources;
    expect(resources).toContainEqual(
      expect.objectContaining({ uri, mimeType: 'text/html;profile=mcp-app' }),
    );
    const resource = (await rpc(app, 'resources/read', { uri })).json().result.contents[0];
    expect(resource.text).toContain('ui/initialize');
    expect(resource.text).not.toContain(created.data.id);
    expect(resource._meta.ui.csp).toMatchObject({ connectDomains: [], resourceDomains: [] });
    expect((await notesCol(db).get()).size).toBe(1);
    await revokeConnection(db, actor.id, grantId);
    expect((await rpc(app, 'resources/read', { uri })).statusCode).toBe(403);
  });

  it('round-trips every tool through the SDK HTTP client with matching JSON text and structured data', async () => {
    const app = await makeApp();
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const client = new Client({ name: 'wally-wire-audit', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL('/mcp', address), {
        requestInit: { headers: { authorization: headers.authorization } },
      }),
    );
    try {
      const listed = ListToolsResultSchema.parse(await client.listTools());
      expect(listed.tools).toHaveLength(15);
      const seen = new Set<string>();
      const invoke = async (name: string, args: Record<string, unknown>) => {
        const result = CallToolResultSchema.parse(await client.callTool({ name, arguments: args }));
        expect(result.isError, JSON.stringify(result)).not.toBe(true);
        expect(result.content).toHaveLength(1);
        const block = result.content[0]!;
        expect(block.type).toBe('text');
        if (block.type !== 'text') throw new Error('Expected text result');
        expect(JSON.parse(block.text)).toEqual(result.structuredContent);
        seen.add(name);
        return result.structuredContent as { data: Record<string, unknown>; revision: number };
      };
      await invoke('list_boards', {});
      await invoke('get_board', { boardId: 'board' });
      await invoke('list_members', { boardId: 'board' });
      const created = await invoke('create_note', {
        boardId: 'board',
        operationId: randomUUID(),
        input: { title: 'Quotes " / Unicode ☃', description: 'Line 1\nLine 2' },
      });
      const noteId = created.data.id;
      await invoke('get_note', { boardId: 'board', noteId });
      await invoke('list_notes', { boardId: 'board' });
      await invoke('show_card', { boardId: 'board', noteId });
      await invoke('show_cards', { boardId: 'board' });
      let revision = created.revision;
      const write = async (name: string, extra: Record<string, unknown> = {}) => {
        const result = await invoke(name, {
          boardId: 'board',
          noteId,
          expectedRevision: revision,
          operationId: randomUUID(),
          ...extra,
        });
        revision = result.revision;
        return result;
      };
      await write('update_note', { input: { title: 'Updated' } });
      await write('move_note', { input: { mode: 'HORIZON', horizon: 'LATER' } });
      await write('complete_note');
      await write('reopen_note');
      await write('assign_note', { input: { assigneeId: null } });
      const subtask = await write('add_subtask', { input: { text: 'Synthetic subtask' } });
      await write('toggle_subtask', { subtaskId: subtask.data.id, input: { done: true } });
      expect([...seen].sort()).toEqual(listed.tools.map((tool) => tool.name).sort());
    } finally {
      await client.close();
    }
  });

  it('preserves result envelopes and data on replay, conflicts and denied-board writes', async () => {
    const app = await makeApp();
    const check = async (name: string, args: unknown, error?: string) => {
      const response = await call(app, name, args);
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('application/json');
      const envelope = response.json();
      expect(envelope).toMatchObject({ jsonrpc: '2.0', id: 1 });
      expect(envelope.error).toBeUndefined();
      const result = CallToolResultSchema.parse(envelope.result);
      const block = result.content[0]!;
      if (block.type !== 'text') throw new Error('Expected text result');
      expect(JSON.parse(block.text)).toEqual(result.structuredContent);
      if (error) {
        expect(result.isError).toBe(true);
        expect(result.structuredContent).toMatchObject({ error });
        expect(result.structuredContent).not.toHaveProperty('data');
      } else expect(result.isError).not.toBe(true);
      return envelope.result;
    };
    const args = { boardId: 'board', operationId: randomUUID(), input: { title: 'Once' } };
    const first = await check('create_note', args);
    expect(await check('create_note', args)).toEqual(first);
    await check(
      'create_note',
      { ...args, input: { title: 'Different' } },
      'IDEMPOTENCY_KEY_REUSED',
    );
    const update = {
      boardId: 'board',
      noteId: first.structuredContent.data.id,
      expectedRevision: 1,
      operationId: randomUUID(),
      input: { title: 'Edited' },
    };
    const edited = await check('update_note', update);
    expect(await check('update_note', update)).toEqual(edited);
    await check(
      'update_note',
      { ...update, operationId: randomUUID(), input: { title: 'Stale' } },
      'STALE_REVISION',
    );
    await check(
      'create_note',
      { ...args, boardId: 'not-a-member', operationId: randomUUID() },
      'NOT_FOUND',
    );
    expect((await notesCol(db).get()).size).toBe(1);
    const note = (await notesCol(db).doc(first.structuredContent.data.id).get()).data();
    expect(note).toMatchObject({ title: 'Edited', revision: 2 });
    await revokeConnection(db, actor.id, grantId);
    expect((await call(app, 'update_note', update)).statusCode).toBe(403);
  });

  it('refuses move_note with a horizon that is not one of the English ones', async () => {
    const app = await makeApp();
    const created = CallToolResultSchema.parse(
      (
        await call(app, 'create_note', {
          boardId: 'board',
          operationId: randomUUID(),
          input: { title: 'Stays put' },
        })
      ).json().result,
    );
    const noteId = (created.structuredContent as { data: { id: string } }).data.id;
    const response = await call(app, 'move_note', {
      boardId: 'board',
      noteId,
      expectedRevision: 1,
      operationId: randomUUID(),
      input: { mode: 'HORIZON', horizon: OLD.horizon },
    });
    expect(response.statusCode).toBe(200);
    const result = CallToolResultSchema.parse(response.json().result);
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/invalid/i);
    expect((await notesCol(db).doc(noteId).get()).data()).toMatchObject({
      horizon: 'TODAY',
      revision: 1,
    });
  });

  it('acknowledges notifications without a body and rejects malformed JSON without effects', async () => {
    const app = await makeApp();
    const notification = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers,
      payload: { jsonrpc: '2.0', method: 'notifications/initialized' },
    });
    expect(notification.statusCode).toBe(202);
    expect(notification.body).toBe('');
    const malformed = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { ...headers, 'content-type': 'application/json' },
      payload: '{bad json',
    });
    expect(malformed.statusCode).toBe(400);
    expect((await notesCol(db).get()).size).toBe(0);
  });

  it('advertises the isolated local transport and accepts only its explicit Inspector origin', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('MCP_LOCAL_URL', 'http://localhost:4502/mcp');
    _resetEnvCacheForTests();
    const app = await makeApp();
    const discovery = await app.inject({ method: 'GET', url: MCP_METADATA_PATH });
    expect(discovery.json().resource).toBe('http://localhost:4502/mcp');
    const denied = await app.inject({ method: 'POST', url: '/mcp', payload: {} });
    expect(denied.headers['www-authenticate']).toContain(
      'http://localhost:4502/.well-known/oauth-protected-resource/mcp',
    );
    expect((await rpc(app, 'tools/list', {}, { origin: 'http://localhost:6274' })).statusCode).toBe(
      200,
    );
    expect((await rpc(app, 'tools/list', {}, { origin: 'http://localhost:6279' })).statusCode).toBe(
      403,
    );
    expect((await rpc(app, 'tools/list', {}, { origin: 'null' })).statusCode).toBe(403);
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/mcp',
      headers: {
        origin: 'http://localhost:6274',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,mcp-protocol-version',
      },
    });
    expect(preflight.headers['access-control-allow-origin']).toBe('http://localhost:6274');
  });

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
    ).toHaveLength(7);
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
    expect(listing.json().result.tools).toHaveLength(15);
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
  it('honors deployment switches and withholds write tools for readonly connections', async () => {
    expect((await rpc(await makeApp({ enabled: false }), 'tools/list')).statusCode).toBe(503);
    const writesOff = await makeApp({ writesEnabled: false });
    expect((await rpc(writesOff, 'tools/list')).json().result.tools).toHaveLength(7);
    for (const app of [writesOff, await makeApp()]) {
      identity.scopes = ['wally:read'];
      expect((await rpc(app, 'tools/list')).json().result.tools).toHaveLength(7);
      const denied = await call(app, 'create_note', {
        boardId: 'board',
        operationId: randomUUID(),
        input: {},
      });
      expect(denied.json().result?.isError ?? Boolean(denied.json().error)).toBe(true);
    }
    const disabled = await call(await makeApp(), 'get_board', { boardId: 'board' });
    expect(disabled.json().result.isError).not.toBe(true);
    expect((await notesCol(db).get()).size).toBe(0);
  });
  it.each(['revoke-new', 'revoke-replay', 'membership-new', 'membership-replay'])(
    'rechecks account-wide access inside the write transaction: %s',
    async (scenario) => {
      const upgraded = await grants.connectAccount(db, actor.id, 'chatgpt');
      let interrupt = false;
      const context: McpToolContext = {
        db,
        actor,
        connectionId: upgraded.id,
        scopes: ['wally:read', 'wally:write'],
        async authorizeBoard(boardId, write) {
          await authorizeConnectionBoard(db, actor, upgraded.id, boardId, write, true);
          if (interrupt) {
            if (scenario.startsWith('revoke')) await revokeConnection(db, actor.id, upgraded.id);
            else
              await whiteboardsCol(db)
                .doc(boardId)
                .update({ ownerId: 'someone-else', memberRoles: {} });
          }
        },
        authorizeWrite: (tx, boardId) =>
          authorizeConnectionBoardInTransaction(db, tx, actor, upgraded.id, boardId, true, true),
      };
      const args = {
        boardId: 'board',
        operationId: randomUUID(),
        input: { title: 'Guarded account access' },
      };
      const replay = scenario.endsWith('replay');
      if (replay) await runMcpTool(context, 'create_note', args);
      interrupt = true;
      await expect(runMcpTool(context, 'create_note', args)).rejects.toMatchObject({
        code: scenario.startsWith('revoke') ? 'MCP_CONSENT_REQUIRED' : 'NOT_FOUND',
      });
      expect((await notesCol(db).get()).size).toBe(replay ? 1 : 0);
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
