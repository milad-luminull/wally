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
    { resource_server: { identifier: 'https://unrelated.example' }, user: {} },
    { accessToken: { setCustomClaim: () => assert.fail('unrelated audience') } },
  );
});
test('verification must be explicitly true and missing email is never fabricated', async () => {
  const claims = {};
  await onExecutePostLogin(
    {
      resource_server: { identifier: 'https://api.wally.luminull.com' },
      user: { email_verified: 'true' },
    },
    {
      accessToken: {
        setCustomClaim: (key, value) => {
          claims[key] = value;
        },
      },
    },
  );
  assert.deepEqual(claims, { [`${ns}email_verified`]: false, [`${ns}name`]: null });
});
test('recent authentication uses the completed primary method time, never refresh or MFA time', async () => {
  for (const protocol of ['oidc-basic-profile', 'oauth2-refresh-token']) {
    const claims = {};
    await onExecutePostLogin(
      {
        resource_server: { identifier: 'https://api.wally.luminull.com' },
        user: {},
        transaction: { protocol },
        authentication: {
          methods: [
            { name: 'pwd', timestamp: '2026-10-23T07:00:00Z' },
            { name: 'mfa', timestamp: '2026-10-23T08:00:00Z' },
          ],
        },
      },
      {
        accessToken: {
          setCustomClaim: (key, value) => {
            claims[key] = value;
          },
        },
      },
    );
    assert.equal(
      claims[`${ns}auth_time`],
      protocol === 'oauth2-refresh-token' ? undefined : Date.parse('2026-10-23T07:00:00Z') / 1000,
    );
  }
});
