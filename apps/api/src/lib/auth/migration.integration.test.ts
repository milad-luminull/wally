import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestUser, getTestDb, resetDatabase } from '../../../test/helpers.js';
import { buildMigrationPlan, executeMigration } from './migration.js';
import { bindImportedIdentity, resolveIdentity } from './identities.js';
const project = 'wally-test-auth0-migration-runner';
const db = getTestDb(project);
beforeAll(async () => {
  await resetDatabase(project);
});
afterAll(async () => {
  await resetDatabase(project);
  await db.terminate();
});
describe('migration runner with real immutable bindings', () => {
  it('resumes exact retries, preserves account data and never reassigns a conflicting subject', async () => {
    await createTestUser(db, 'original', 'original@example.com');
    await createTestUser(db, 'other', 'other@example.com');
    await db.collection('users').doc('original').update({ language: 'en' });
    const plan = buildMigrationPlan(
      project,
      'db',
      [
        {
          uid: 'original',
          email: 'original@example.com',
          emailVerified: true,
          disabled: false,
          providers: [{ providerId: 'google.com', uid: '12345' }],
        },
      ],
      ['original'],
    );
    const read = async () => ({
      user_id: 'google-oauth2|12345',
      identities: [{ provider: 'google-oauth2', user_id: '12345', connection: 'google-oauth2' }],
    });
    const bind = (identity: { issuer: string; subject: string }, uid: string) =>
      bindImportedIdentity(db, identity, uid);
    await executeMigration(plan, read, bind, false);
    expect((await db.collection('authIdentities').get()).empty).toBe(true);
    await executeMigration(plan, read, bind, true);
    const before = (await db.collection('authIdentities').get()).docs[0]!.data();
    await executeMigration(plan, read, bind, true);
    expect((await db.collection('authIdentities').get()).docs[0]!.data()).toEqual(before);
    expect((await db.collection('users').doc('original').get()).data()?.language).toBe('en');
    const conflict = {
      ...plan,
      identities: plan.identities.map((i) => ({ ...i, userId: 'other' })),
    };
    expect((await executeMigration(conflict, read, bind, true))[0]).toMatchObject({
      status: 'failed',
      errorCode: 'IDENTITY_CONFLICT',
    });
    expect(
      await resolveIdentity(db, { issuer: plan.issuer, subject: plan.identities[0]!.subject }),
    ).toBe('original');
    await db.collection('users').doc('original').delete();
    expect((await executeMigration(plan, read, bind, true))[0]?.status).toBe('failed');
  });
});
