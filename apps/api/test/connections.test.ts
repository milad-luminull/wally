import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import {
  createFakeAuthVerifier,
  createTestBoard,
  createTestUser,
  getTestDb,
  resetDatabase,
} from './helpers.js';
import connectionRoutes from '../src/routes/connections.js';

const project = 'wally-test-connection-routes';
const db = getTestDb(project);
const auth = createFakeAuthVerifier();
let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  app = await buildApp({ db, logger: false, authVerifier: auth.verifier });
  // Scoped registration keeps these tests independent of deployment configuration.
  await app.register(connectionRoutes, {
    prefix: '/test',
    enabled: true,
    writesEnabled: false,
    clientId: 'chatgpt',
  });
});
beforeEach(async () => {
  await resetDatabase(project);
  await createTestUser(db, 'owner', 'owner@example.com');
  await createTestBoard(db, 'owner');
  for (const id of ['owner', 'editor'])
    auth.tokens.set(id, { uid: id, email: `${id}@example.com`, emailVerified: true, name: null });
});
afterAll(async () => {
  await app.close();
  await resetDatabase(project);
});
const headers = (id = 'owner') => ({ authorization: `Bearer ${id}` });
const connect = (
  payload: Record<string, unknown> = { clientId: 'chatgpt' },
  authHeaders = headers(),
) =>
  app.inject({
    method: 'POST',
    url: '/test/me/connections/connect',
    headers: authHeaders,
    payload,
  });
it('connects without board setup and isolates disconnect by user', async () => {
  expect((await app.inject({ url: '/test/me/connections' })).statusCode).toBe(401);
  const created = await connect();
  expect(created.statusCode).toBe(200);
  expect(created.json()).not.toHaveProperty('issuedAfter');
  expect(created.json()).not.toHaveProperty('boardIds');
  expect(created.json()).not.toHaveProperty('access');
  expect((await connect()).json().id).toBe(created.json().id);
  expect(
    (await app.inject({ url: '/test/me/connections', headers: headers('editor') })).json()
      .connections,
  ).toEqual([]);
  expect(
    (
      await app.inject({
        method: 'DELETE',
        url: `/test/me/connections/${created.json().id}`,
        headers: headers('editor'),
      })
    ).statusCode,
  ).toBe(404);
  for (let i = 0; i < 2; i++)
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/test/me/connections/${created.json().id}`,
          headers: headers(),
        })
      ).statusCode,
    ).toBe(204);
});
it('rejects client substitution, unauthenticated requests and obsolete board-selection input', async () => {
  expect((await connect({ clientId: 'wrong' })).statusCode).toBe(400);
  expect(
    (await connect({ clientId: 'chatgpt' }, {} as ReturnType<typeof headers>)).statusCode,
  ).toBe(401);
  expect((await connect({ clientId: 'chatgpt', boardIds: ['owner'] })).statusCode).toBe(400);
  expect(
    (
      await app.inject({
        method: 'PATCH',
        url: '/test/whiteboards/owner/mcp-access',
        headers: headers(),
        payload: { enabled: true },
      })
    ).statusCode,
  ).toBe(404);
});
it('requires verified email before connecting', async () => {
  auth.tokens.set('owner', {
    uid: 'owner',
    email: 'owner@example.com',
    emailVerified: false,
    name: null,
  });
  expect((await connect()).statusCode).toBe(403);
});
