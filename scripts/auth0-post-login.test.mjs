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
