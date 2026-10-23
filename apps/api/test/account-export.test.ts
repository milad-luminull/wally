import { afterAll, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildTestApp, registerTestUser, resetDatabase, addTestMember } from './helpers.js';
import { executeBoardCommand } from '../src/lib/commands/index.js';
import { notesCol, whiteboardsCol } from '../src/lib/db/collections.js';
const project = 'wally-account-export-test';
const ctx = await buildTestApp(project);
beforeEach(() => resetDatabase(project));
afterAll(async () => {
  await resetDatabase(project);
  await ctx.app.close();
});
it('exports accessible data and own connections without private notes or share credentials', async () => {
  const token = registerTestUser(ctx, 'owner', 'owner@example.com');
  const other = registerTestUser(ctx, 'other', 'other@example.com');
  await ctx.inject({ method: 'GET', url: '/me', headers: ctx.authHeader(token) });
  await ctx.inject({ method: 'GET', url: '/me', headers: ctx.authHeader(other) });
  await addTestMember(ctx.db, 'other', 'owner', 'VIEW');
  await whiteboardsCol(ctx.db).doc('other').update({ shareLinkToken: 'secret-share-token' });
  const actor = { id: 'other', email: 'other@example.com', emailVerified: true };
  await executeBoardCommand(
    ctx.db,
    actor,
    { type: 'note.create', boardId: 'other', input: { title: 'Visible shared note' } },
    { operationId: randomUUID() },
  );
  await executeBoardCommand(
    ctx.db,
    actor,
    {
      type: 'note.create',
      boardId: 'other',
      input: { title: 'Secret private note', visibility: 'PRIVATE' },
    },
    { operationId: randomUUID() },
  );
  const before = (await notesCol(ctx.db).get()).size;
  const response = await ctx.inject({
    method: 'GET',
    url: '/me/export',
    headers: ctx.authHeader(token),
  });
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.headers['content-disposition']).toContain('attachment');
  expect(response.json()).toMatchObject({ version: 1, profile: { id: 'owner' } });
  expect(
    response
      .json()
      .boards.map((b: { id: string }) => b.id)
      .sort(),
  ).toEqual(['other', 'owner']);
  expect(response.body).toContain('Visible shared note');
  expect(response.body).not.toContain('Secret private note');
  expect(response.body).not.toContain('secret-share-token');
  expect((await notesCol(ctx.db).get()).size).toBe(before);
});
it('rejects export without authentication', async () => {
  expect((await ctx.inject({ method: 'GET', url: '/me/export' })).statusCode).toBe(401);
});

it('exports identity, connection, usage and audit records through explicit safe fields', async () => {
  const token = registerTestUser(ctx, 'owner', 'owner@example.com');
  await ctx.inject({ method: 'GET', url: '/me', headers: ctx.authHeader(token) });
  const user = ctx.db.collection('users').doc('owner');
  await ctx.db.collection('authIdentities').doc('mapping').set({
    userId: 'owner',
    issuer: 'https://login.example/',
    subject: 'auth0|owner',
    clientSecret: 'never-export-identity-secret',
  });
  await user
    .collection('mcpConnections')
    .doc('connection')
    .set({
      id: 'connection',
      clientId: 'client',
      name: 'ChatGPT',
      scopes: ['wally:read'],
      createdAt: '2026-10-23T00:00:00Z',
      revokedAt: null,
      accessToken: 'never-export-access-token',
    });
  await user
    .collection('mcpLimits')
    .doc('writes')
    .set({
      window: 123,
      count: 2,
      connections: { abc: 2 },
      internalCredential: 'never-export-counter-secret',
    });
  await ctx.db.collection('assistantAudit').doc('audit').set({
    actorId: 'owner',
    operationId: 'operation',
    boardId: 'owner',
    targetId: null,
    commandType: 'board.update',
    revision: 2,
    occurredAt: new Date(),
    credential: 'never-export-audit-secret',
  });
  const response = await ctx.inject({
    method: 'GET',
    url: '/me/export',
    headers: ctx.authHeader(token),
  });
  expect(response.statusCode).toBe(200);
  expect(response.json().identities).toEqual([
    { issuer: 'https://login.example/', subject: 'auth0|owner' },
  ]);
  expect(response.json().connections).toHaveLength(1);
  expect(response.json().usage.mcp).toEqual([
    { kind: 'writes', window: 123, count: 2, connections: { abc: 2 } },
  ]);
  expect(response.json().audit).toEqual([expect.objectContaining({ operationId: 'operation' })]);
  expect(response.body).not.toContain('never-export');
});
