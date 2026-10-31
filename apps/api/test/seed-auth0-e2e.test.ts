import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDatabase, createTestUser, resetDatabase, type TestDatabase } from './helpers.js';
import { resolveIdentity } from '../src/lib/auth/identities.js';
import { seedAuth0E2eIdentity } from '../src/lib/auth/e2e-seed.js';
import { authIdentities, users } from '../src/lib/postgres/schema/index.js';

let handle: TestDatabase;
const config = {
  DATABASE_URL: process.env.DATABASE_URL,
  NODE_ENV: 'test',
  E2E_AUTH0_SUBJECT: 'auth0|ci-fixture',
  E2E_AUTH0_EMAIL: 'ci@example.invalid',
};
const identity = { issuer: 'https://login.luminull.com/', subject: 'auth0|ci-fixture' };

beforeAll(async () => {
  handle = await createTestDatabase();
});
beforeEach(async () => {
  await resetDatabase(handle.db);
  await createTestUser(handle.db, 'seed-owner', 'demo@example.invalid');
});
afterAll(() => handle?.drop());

describe('Auth0 CI identity fixture', () => {
  it('binds a test identity to the seeded owner without creating a second account', async () => {
    const { db } = handle;
    await seedAuth0E2eIdentity(db, config);
    await seedAuth0E2eIdentity(db, config);
    expect(await resolveIdentity(db, identity)).toBe('seed-owner');
    expect(await db.$count(users)).toBe(1);
    const [owner] = await db.select().from(users).where(eq(users.id, 'seed-owner'));
    expect(owner?.email).toBe('ci@example.invalid');
  });

  it.each([
    ['a hosted database', { DATABASE_URL: 'postgres://u:p@db.abc.supabase.co:5432/postgres' }],
    ['no database URL', { DATABASE_URL: undefined }],
    ['a production process', { NODE_ENV: 'production' }],
  ])('refuses to write with %s', async (_label, override) => {
    await expect(seedAuth0E2eIdentity(handle.db, { ...config, ...override })).rejects.toThrow(
      'requires a local database',
    );
    expect(await handle.db.$count(authIdentities)).toBe(0);
  });

  it.each(['google-oauth2|human', '', 'auth0|'])(
    'rejects non-test database subject %s',
    async (subject) => {
      await expect(
        seedAuth0E2eIdentity(handle.db, { ...config, E2E_AUTH0_SUBJECT: subject }),
      ).rejects.toThrow();
      expect(await handle.db.$count(authIdentities)).toBe(0);
    },
  );
});
