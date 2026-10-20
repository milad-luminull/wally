import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { VerifiedIdentity } from '../src/lib/auth/auth0.js';
import { bindImportedIdentity } from '../src/lib/auth/identities.js';
import {
  createFakeAuthVerifier,
  createTestUser,
  createTestBoard,
  createTestMembership,
  getTestDb,
  resetDatabase,
} from './helpers.js';
const project = 'wally-test-auth0-signup';
const db = getTestDb(project);
const identity: VerifiedIdentity = {
  issuer: 'https://login.luminull.com/',
  subject: 'auth0|new',
  email: 'New@Example.com',
  emailVerified: false,
  name: 'New',
};
const token = (subject: string) =>
  `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ iss: identity.issuer, sub: subject })).toString('base64url')}.signature`;
let enabled: Awaited<ReturnType<typeof buildApp>>;
let disabled: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  const opts = {
    db,
    logger: false as const,
    authVerifier: createFakeAuthVerifier().verifier,
    auth0Verifier: {
      async verify(value: string) {
        return {
          ...identity,
          subject: JSON.parse(Buffer.from(value.split('.')[1]!, 'base64url').toString())
            .sub as string,
        };
      },
    },
  };
  enabled = await buildApp({ ...opts, auth0SignupEnabled: true });
  disabled = await buildApp({ ...opts, auth0SignupEnabled: false });
});
beforeEach(async () => resetDatabase(project));
afterAll(async () => {
  await enabled.close();
  await disabled.close();
});
const me = (subject = identity.subject, app = enabled) =>
  app.inject({
    method: 'GET',
    url: '/me',
    headers: { authorization: `Bearer ${token(subject)}`, 'accept-language': 'en' },
  });
describe('opt-in Auth0 signup', () => {
  it('does not activate a pending invite until the same mapped identity verifies email', async () => {
    await createTestUser(db, 'owner', 'owner@example.com');
    await createTestBoard(db, 'owner');
    const memberId = await createTestMembership(db, 'owner', {
      invitedEmail: 'new@example.com',
      role: 'EDIT',
      status: 'PENDING',
    });
    const response = await me();
    expect(response.statusCode).toBe(200);
    const ref = db.collection('whiteboards').doc('owner').collection('members').doc(memberId);
    expect((await ref.get()).data()?.status).toBe('PENDING');
    identity.emailVerified = true;
    try {
      expect((await me()).statusCode).toBe(200);
      expect((await ref.get()).data()).toMatchObject({
        status: 'ACTIVE',
        userId: response.json().id,
      });
    } finally {
      identity.emailVerified = false;
    }
  });
  it('preserves an imported user ID and preferences when signup is enabled', async () => {
    await createTestUser(db, 'firebase-stable', 'new@example.com');
    await db.collection('users').doc('firebase-stable').update({ 'preferences.theme': 'dark' });
    await bindImportedIdentity(db, identity, 'firebase-stable');
    expect((await me()).json()).toMatchObject({
      id: 'firebase-stable',
      preferences: { theme: 'dark' },
    });
    expect((await db.collection('whiteboards').get()).empty).toBe(true);
  });

  it('leaves unmapped accounts blocked by default', async () => {
    expect((await me(identity.subject, disabled)).statusCode).toBe(403);
    expect((await db.collection('users').get()).empty).toBe(true);
  });
  it('atomically creates a fresh stable ID, initial board and mapping without marking email verified', async () => {
    const response = await me();
    expect(response.statusCode).toBe(200);
    const id = response.json().id as string;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const user = (await db.collection('users').doc(id).get()).data();
    expect(user).toMatchObject({ email: 'new@example.com', emailVerified: false, language: 'en' });
    expect((await db.collection('whiteboards').doc(id).get()).data()?.ownerId).toBe(id);
    expect((await db.collection('authIdentities').get()).size).toBe(1);
  });
  it('denies an existing email without linking or creating a board', async () => {
    await createTestUser(db, 'firebase-existing', 'new@example.com');
    const response = await me();
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe('IDENTITY_NOT_LINKED');
    expect((await db.collection('users').get()).size).toBe(1);
    expect((await db.collection('authIdentities').get()).empty).toBe(true);
    expect((await db.collection('whiteboards').get()).empty).toBe(true);
  });
  it('concurrent requests from one subject create one account and one board', async () => {
    const responses = await Promise.all([me(), me()]);
    expect(responses.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(responses[0]!.json().id).toBe(responses[1]!.json().id);
    expect((await db.collection('users').get()).size).toBe(1);
    expect((await db.collection('whiteboards').get()).size).toBe(1);
  });
  it('concurrent different subjects with the same email cannot create duplicate accounts', async () => {
    const responses = await Promise.all([me('auth0|first'), me('google-oauth2|second')]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 403]);
    expect((await db.collection('users').get()).size).toBe(1);
    expect((await db.collection('authIdentities').get()).size).toBe(1);
  });
  it('never resurrects a deleted mapped user even with signup enabled', async () => {
    await createTestUser(db, 'deleted', 'new@example.com');
    await bindImportedIdentity(db, identity, 'deleted');
    await db.collection('users').doc('deleted').delete();
    expect((await me()).statusCode).toBe(403);
    expect((await db.collection('users').get()).empty).toBe(true);
    expect((await db.collection('whiteboards').get()).empty).toBe(true);
  });
});
