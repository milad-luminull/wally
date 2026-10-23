import { Timestamp } from 'firebase-admin/firestore';
import { afterAll, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildTestApp, registerTestUser, resetDatabase } from './helpers.js';
import { executeBoardCommand } from '../src/lib/commands/index.js';
const project = 'wally-account-deletion-test';
const ctx = await buildTestApp(project);
beforeEach(() => resetDatabase(project));
afterAll(async () => {
  await resetDatabase(project);
  await ctx.app.close();
});
async function owner(recent = true) {
  const token = registerTestUser(ctx, 'owner', 'owner@example.com');
  Object.assign(ctx.tokens.get(token)!, {
    authenticatedAt: Math.floor(Date.now() / 1000) - (recent ? 0 : 3600),
  });
  await ctx.inject({ method: 'GET', url: '/me', headers: ctx.authHeader(token) });
  return token;
}
it('requires recent interactive authentication and explicit confirmation', async () => {
  const stale = await owner(false);
  const response = await ctx.inject({
    method: 'DELETE',
    url: '/me',
    headers: ctx.authHeader(stale),
    payload: { confirmation: 'DELETE' },
  });
  expect(response.statusCode).toBe(403);
  expect(response.json().error).toBe('RECENT_AUTH_REQUIRED');
  const fresh = await owner();
  expect(
    (
      await ctx.inject({
        method: 'DELETE',
        url: '/me',
        headers: ctx.authHeader(fresh),
        payload: { confirmation: 'yes' },
      })
    ).statusCode,
  ).toBe(400);
  expect((await ctx.db.collection('users').doc('owner').get()).exists).toBe(true);
});
it('accepts cleanup durably, blocks old tokens and commands immediately, and cannot recreate the user', async () => {
  const token = await owner();
  const response = await ctx.inject({
    method: 'DELETE',
    url: '/me',
    headers: ctx.authHeader(token),
    payload: { confirmation: 'DELETE' },
  });
  expect(response.statusCode).toBe(202);
  expect(response.json()).toMatchObject({ status: 'pending' });
  expect((await ctx.db.collection('accountDeletionJobs').doc('owner').get()).exists).toBe(true);
  expect(
    (await ctx.inject({ method: 'GET', url: '/me', headers: ctx.authHeader(token) })).statusCode,
  ).toBe(403);
  await expect(
    executeBoardCommand(
      ctx.db,
      { id: 'owner', email: 'owner@example.com', emailVerified: true },
      { type: 'board.create', input: { name: 'Cannot resurrect' } },
      { operationId: randomUUID() },
    ),
  ).rejects.toMatchObject({ code: 'ACCOUNT_DELETED' });
  await ctx.db.collection('users').doc('owner').delete();
  expect(
    (await ctx.inject({ method: 'GET', url: '/me', headers: ctx.authHeader(token) })).statusCode,
  ).toBe(403);
  expect((await ctx.db.collection('users').doc('owner').get()).exists).toBe(false);
});

it('resumes provider failures while removing owned boards and preserving anonymized shared contributions', async () => {
  const { processAccountDeletion } = await import('../src/lib/account/cleanup.js');
  const token = await owner();
  const other = registerTestUser(ctx, 'other', 'other@example.com');
  await ctx.inject({ method: 'GET', url: '/me', headers: ctx.authHeader(other) });
  const { addTestMember } = await import('./helpers.js');
  await addTestMember(ctx.db, 'other', 'owner', 'EDIT');
  const actor = { id: 'owner', email: 'owner@example.com', emailVerified: true };
  await executeBoardCommand(
    ctx.db,
    actor,
    { type: 'note.create', boardId: 'other', input: { title: 'Shared contribution' } },
    { operationId: randomUUID() },
  );
  await executeBoardCommand(
    ctx.db,
    actor,
    {
      type: 'note.create',
      boardId: 'other',
      input: { title: 'Private contribution', visibility: 'PRIVATE' },
    },
    { operationId: randomUUID() },
  );
  await ctx.db
    .collection('authIdentities')
    .doc('linked')
    .set({ userId: 'owner', issuer: 'https://login.example/', subject: 'auth0|exact-owner' });
  await ctx.inject({
    method: 'DELETE',
    url: '/me',
    headers: ctx.authHeader(token),
    payload: { confirmation: 'DELETE' },
  });
  await ctx.db
    .collection('accountDeletionJobs')
    .doc('owner')
    .update({ createdAt: Timestamp.fromMillis(Date.now() - 120_001) });
  const calls: string[] = [];
  const providers: import('../src/lib/account/cleanup.js').DeletionProviders = {
    deleteFirebase: async (id: string) => {
      calls.push(id);
    },
    deleteAuth0: async (_issuer: string, subject: string) => {
      calls.push(subject);
      throw new Error('provider unavailable');
    },
  };
  expect(await processAccountDeletion(ctx.db, 'owner', providers)).toBe('pending');
  expect(
    (await ctx.db.collection('accountDeletionJobs').doc('owner').get()).data()?.status,
  ).not.toBe('complete');
  expect((await ctx.db.collection('whiteboards').doc('owner').get()).exists).toBe(false);
  expect(
    (await ctx.db.collection('whiteboards').doc('other').get()).data()?.memberRoles,
  ).not.toHaveProperty('owner');
  const notes = (await ctx.db.collection('notes').get()).docs.map((doc) => doc.data());
  expect(notes).toHaveLength(1);
  expect(notes[0]).toMatchObject({
    title: 'Shared contribution',
    createdById: null,
    assigneeId: null,
  });
  providers.deleteAuth0 = async (_issuer, subject) => {
    calls.push(subject);
  };
  expect(await processAccountDeletion(ctx.db, 'owner', providers)).toBe('complete');
  expect(await processAccountDeletion(ctx.db, 'owner', providers)).toBe('complete');
  expect(calls.every((id) => id === 'owner' || id === 'auth0|exact-owner')).toBe(true);
  expect((await ctx.db.collection('authIdentities').doc('linked').get()).exists).toBe(false);
  expect((await ctx.db.collection('users').doc('owner').get()).exists).toBe(false);
  expect(
    (await ctx.inject({ method: 'GET', url: '/me', headers: ctx.authHeader(token) })).statusCode,
  ).toBe(403);
});

it('fences late connection establishment, budget writes and assistant creation', async () => {
  const token = await owner();
  await ctx.inject({
    method: 'DELETE',
    url: '/me',
    headers: ctx.authHeader(token),
    payload: { confirmation: 'DELETE' },
  });
  const { requireConnection, connectAccount } = await import('../src/lib/mcp/grants.js');
  const { consumeMcpRequestBudget } = await import('../src/lib/mcp/rate.js');
  const { createConversation } = await import('../src/lib/assistant/conversations.js');
  await expect(
    requireConnection(
      ctx.db,
      'owner',
      { clientId: 'client', issuedAt: 123, scopes: ['wally:read'] },
      true,
    ),
  ).rejects.toMatchObject({ code: 'ACCOUNT_DELETED' });
  await expect(connectAccount(ctx.db, 'owner', 'client')).rejects.toMatchObject({
    code: 'ACCOUNT_DELETED',
  });
  await expect(consumeMcpRequestBudget(ctx.db, 'owner', 'client')).rejects.toMatchObject({
    code: 'ACCOUNT_DELETED',
  });
  await expect(
    createConversation(ctx.db, 'owner', 'owner', 'test', new Date()),
  ).rejects.toMatchObject({ code: 'ACCOUNT_DELETED' });
});

it('rejects assigning cards to an account whose deletion has started', async () => {
  const token = await owner();
  const other = registerTestUser(ctx, 'other', 'other@example.com');
  await ctx.inject({ method: 'GET', url: '/me', headers: ctx.authHeader(other) });
  const { addTestMember } = await import('./helpers.js');
  await addTestMember(ctx.db, 'other', 'owner', 'EDIT');
  await ctx.inject({
    method: 'DELETE',
    url: '/me',
    headers: ctx.authHeader(token),
    payload: { confirmation: 'DELETE' },
  });
  await expect(
    executeBoardCommand(
      ctx.db,
      { id: 'other', email: 'other@example.com', emailVerified: true },
      {
        type: 'note.create',
        boardId: 'other',
        input: { title: 'Must not assign', assigneeId: 'owner' },
      },
      { operationId: randomUUID() },
    ),
  ).rejects.toMatchObject({ code: 'ACCOUNT_DELETED' });
});

it('keeps cleanup pending while requests authenticated before deletion can still be finishing', async () => {
  const { processAccountDeletion } = await import('../src/lib/account/cleanup.js');
  const token = await owner();
  await ctx.inject({
    method: 'DELETE',
    url: '/me',
    headers: ctx.authHeader(token),
    payload: { confirmation: 'DELETE' },
  });
  let providerCalls = 0;
  const providers = {
    deleteFirebase: async () => {
      providerCalls++;
    },
    deleteAuth0: async () => {
      providerCalls++;
    },
  };
  expect(await processAccountDeletion(ctx.db, 'owner', providers)).toBe('pending');
  expect(providerCalls).toBe(0);
});
it('does not provision a new Auth0 account after its mapping has been cleaned up', async () => {
  const { resolveOrCreateIdentity } = await import('../src/lib/auth/identities.js');
  const token = await owner();
  await ctx.db
    .collection('authIdentities')
    .doc('linked')
    .set({ userId: 'owner', issuer: 'https://login.example/', subject: 'auth0|exact-owner' });
  await ctx.inject({
    method: 'DELETE',
    url: '/me',
    headers: ctx.authHeader(token),
    payload: { confirmation: 'DELETE' },
  });
  await ctx.db.collection('authIdentities').doc('linked').delete();
  await expect(
    resolveOrCreateIdentity(
      ctx.db,
      {
        issuer: 'https://login.example/',
        subject: 'auth0|exact-owner',
        email: 'owner@example.com',
        emailVerified: true,
        name: null,
      },
      'en',
    ),
  ).rejects.toMatchObject({ code: 'ACCOUNT_DELETED' });
});

it('serializes deletion against concurrent writes and rejects their later retries', async () => {
  const { processAccountDeletion } = await import('../src/lib/account/cleanup.js');
  const token = await owner();
  const actor = { id: 'owner', email: 'owner@example.com', emailVerified: true };
  const operationId = randomUUID();
  const command = {
    type: 'note.create' as const,
    boardId: 'owner',
    input: { title: 'Racing card' },
  };
  const results = await Promise.allSettled([
    executeBoardCommand(ctx.db, actor, command, { operationId }),
    ctx.inject({
      method: 'DELETE',
      url: '/me',
      headers: ctx.authHeader(token),
      payload: { confirmation: 'DELETE' },
    }),
  ]);
  expect(results[1].status).toBe('fulfilled');
  if (results[1].status === 'fulfilled')
    expect((results[1].value as { statusCode: number }).statusCode).toBe(202);
  await expect(executeBoardCommand(ctx.db, actor, command, { operationId })).rejects.toMatchObject({
    code: 'ACCOUNT_DELETED',
  });
  await ctx.db
    .collection('accountDeletionJobs')
    .doc('owner')
    .update({ createdAt: Timestamp.fromMillis(Date.now() - 120_001) });
  expect(
    await processAccountDeletion(ctx.db, 'owner', {
      deleteFirebase: async () => {},
      deleteAuth0: async () => {},
    }),
  ).toBe('complete');
  expect((await ctx.db.collection('notes').get()).empty).toBe(true);
  expect((await ctx.db.collection('whiteboards').get()).empty).toBe(true);
});
