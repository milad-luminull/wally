import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { onExecutePostLogin } = createRequire(import.meta.url)('../infra/auth0-post-login.cjs');
const ns = 'https://wally.luminull.com/';
test('signed profile claims are restricted to Wally audiences', async () => {
  for (const audience of ['https://api.wally.luminull.com', 'https://api.wally.luminull.com/mcp']) {
    const claims = {};
    await onExecutePostLogin(
      {
        resource_server: { identifier: audience },
        user: { email: 'user@example.com', email_verified: true, name: 'User' },
      },
      {
        accessToken: {
          setCustomClaim: (key, value) => {
            claims[key] = value;
          },
        },
      },
    );
    assert.deepEqual(claims, {
      [`${ns}email`]: 'user@example.com',
      [`${ns}email_verified`]: true,
      [`${ns}name`]: 'User',
    });
  }
  await onExecutePostLogin(
    {
      resource_server: { identifier: 'https://unrelated.example' },
      user: { email_verified: true },
    },
    {
      access: { deny: () => assert.fail('verified user denied') },
      accessToken: { setCustomClaim: () => assert.fail('unrelated audience') },
    },
  );
});
test('a login without an explicitly verified email is denied before any claim', async () => {
  for (const user of [
    { email: 'user@example.com', email_verified: 'true' },
    { email_verified: false },
    {},
  ]) {
    for (const identifier of ['https://api.wally.luminull.com', 'https://unrelated.example']) {
      const denied = [];
      await onExecutePostLogin(
        { resource_server: { identifier }, user },
        {
          access: { deny: (reason) => denied.push(reason) },
          accessToken: { setCustomClaim: () => assert.fail('claim set for an unverified user') },
        },
      );
      assert.deepEqual(denied, ['EMAIL_NOT_VERIFIED']);
    }
  }
});
const webClient = 'web-client-id';
const secrets = { WEB_CLIENT_ID: webClient };
test("Wally's web client gets role authenticated on its ID token only", async () => {
  for (const identifier of ['https://api.wally.luminull.com', undefined]) {
    const idClaims = {};
    const accessClaims = {};
    await onExecutePostLogin(
      {
        secrets,
        client: { client_id: webClient },
        resource_server: identifier ? { identifier } : undefined,
        user: { email: 'user@example.com', email_verified: true, name: 'User' },
      },
      {
        idToken: { setCustomClaim: (key, value) => (idClaims[key] = value) },
        accessToken: { setCustomClaim: (key, value) => (accessClaims[key] = value) },
      },
    );
    assert.deepEqual(idClaims, { role: 'authenticated' });
    assert.equal('role' in accessClaims, false);
  }
});
test('other clients and unverified logins get no role claim', async () => {
  await onExecutePostLogin(
    {
      secrets,
      client: { client_id: 'some-mcp-client' },
      resource_server: { identifier: 'https://api.wally.luminull.com/mcp' },
      user: { email_verified: true },
    },
    {
      idToken: { setCustomClaim: () => assert.fail('role set for another client') },
      accessToken: { setCustomClaim: () => {} },
    },
  );
  const denied = [];
  await onExecutePostLogin(
    { secrets, client: { client_id: webClient }, user: { email_verified: false } },
    {
      access: { deny: (reason) => denied.push(reason) },
      idToken: { setCustomClaim: () => assert.fail('role set for an unverified user') },
    },
  );
  assert.deepEqual(denied, ['EMAIL_NOT_VERIFIED']);
});
test('without the WEB_CLIENT_ID secret no token gets the role claim', async () => {
  for (const secrets of [undefined, {}, { WEB_CLIENT_ID: '' }]) {
    await onExecutePostLogin(
      { secrets, client: { client_id: '' }, user: { email_verified: true } },
      { idToken: { setCustomClaim: () => assert.fail('role set without the secret') } },
    );
  }
});
