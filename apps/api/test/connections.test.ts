import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import {
  addTestMember,
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
const enable = () =>
  app.inject({
    method: 'PATCH',
    url: '/test/whiteboards/owner/mcp-access',
    headers: headers(),
    payload: { enabled: true },
  });
it('requires authentication and owner approval, then supports private revocation', async () => {
  expect((await app.inject({ url: '/test/me/connections' })).statusCode).toBe(401);
  const create = () =>
    app.inject({
      method: 'POST',
      url: '/test/me/connections',
      headers: headers(),
      payload: { clientId: 'chatgpt', boardIds: ['owner'] },
    });
  expect((await create()).statusCode).toBe(403);
  expect((await enable()).statusCode).toBe(200);
  const created = await create();
  expect(created.statusCode).toBe(201);
  expect(created.json()).not.toHaveProperty('issuedAfter');
  const id = created.json().id as string;
  expect(
    (await app.inject({ url: '/test/me/connections', headers: headers('editor') })).json()
      .connections,
  ).toEqual([]);
  expect(
    (
      await app.inject({
        method: 'DELETE',
        url: `/test/me/connections/${id}`,
        headers: headers('editor'),
      })
    ).statusCode,
  ).toBe(404);
  for (let attempt = 0; attempt < 2; attempt++)
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/test/me/connections/${id}`,
          headers: headers(),
        })
      ).statusCode,
    ).toBe(204);
  expect(
    (await app.inject({ url: '/test/me/connections', headers: headers() })).json().connections[0]
      .revokedAt,
  ).toEqual(expect.any(String));
});
it('rejects client substitution, write escalation, and enabling by members', async () => {
  await addTestMember(db, 'owner', 'editor', 'EDIT');
  expect(
    (
      await app.inject({
        method: 'PATCH',
        url: '/test/whiteboards/owner/mcp-access',
        headers: headers('editor'),
        payload: { enabled: true },
      })
    ).statusCode,
  ).toBe(403);
  await enable();
  for (const payload of [
    { clientId: 'attacker', boardIds: ['owner'] },
    { clientId: 'chatgpt', boardIds: ['owner'], write: true },
  ]) {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/test/me/connections',
          headers: headers(),
          payload,
        })
      ).statusCode,
    ).toBe(payload.write ? 403 : 400);
  }
});
it('requires verified email before granting access', async () => {
  auth.tokens.set('owner', {
    uid: 'owner',
    email: 'owner@example.com',
    emailVerified: false,
    name: null,
  });
  expect((await enable()).statusCode).toBe(403);
});
