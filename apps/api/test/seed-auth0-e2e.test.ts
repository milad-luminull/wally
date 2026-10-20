import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getTestDb, resetDatabase, createTestUser } from './helpers.js';
import { resolveIdentity } from '../src/lib/auth/identities.js';
import { seedAuth0E2eIdentity } from '../src/lib/auth/e2e-seed.js';

const project = 'wally-e2e';
const db = getTestDb(project);
const config = {
  FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST,
  E2E_AUTH0_SUBJECT: 'auth0|ci-fixture',
  E2E_AUTH0_EMAIL: 'ci@example.invalid',
};
const identity = { issuer: 'https://login.luminull.com/', subject: 'auth0|ci-fixture' };

beforeEach(async () => {
  await resetDatabase(project);
  await createTestUser(db, 'seed-owner', 'demo@example.invalid');
});
afterAll(() => db.terminate());

describe('Auth0 CI identity fixture', () => {
  it('binds a test identity to the seeded owner without creating a second account', async () => {
    await seedAuth0E2eIdentity(db, config);
    await seedAuth0E2eIdentity(db, config);
    expect(await resolveIdentity(db, identity)).toBe('seed-owner');
    expect((await db.collection('users').get()).size).toBe(1);
    expect((await db.collection('users').doc('seed-owner').get()).data()?.email).toBe(
      'ci@example.invalid',
    );
  });

  it('refuses to write without an emulator', async () => {
    await expect(
      seedAuth0E2eIdentity(db, { ...config, FIRESTORE_EMULATOR_HOST: undefined }),
    ).rejects.toThrow('emulator');
    expect((await db.collection('authIdentities').get()).empty).toBe(true);
  });

  it('refuses another project even with an emulator configured', async () => {
    const other = getTestDb('wally-e2e-wrong-project');
    await expect(seedAuth0E2eIdentity(other, config)).rejects.toThrow('wally-e2e');
    await other.terminate();
  });

  it.each(['google-oauth2|human', '', 'auth0|'])(
    'rejects non-test database subject %s',
    async (subject) => {
      await expect(
        seedAuth0E2eIdentity(db, { ...config, E2E_AUTH0_SUBJECT: subject }),
      ).rejects.toThrow();
      expect((await db.collection('authIdentities').get()).empty).toBe(true);
    },
  );
});
