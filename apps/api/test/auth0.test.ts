import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { bindKnownIdentity } from '../src/lib/auth/identities.js';
import type { VerifiedIdentity } from '../src/lib/auth/auth0.js';
import { createFakeAuthVerifier, createTestUser, getTestDb, resetDatabase } from './helpers.js';
import { usersCol, whiteboardsCol } from '../src/lib/db/collections.js';

const project = 'wally-test-auth0-boundary';
const db = getTestDb(project);
const identity: VerifiedIdentity = {
  issuer: 'https://login.luminull.com/',
  subject: 'auth0|linked-user',
  email: 'existing@example.com',
  emailVerified: true,
  name: 'Existing',
};
const auth0Token = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ iss: identity.issuer })).toString('base64url')}.signature`;
const firebase = createFakeAuthVerifier();
let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  await resetDatabase(project);
  app = await buildApp({
    db,
    logger: false,
    authVerifier: firebase.verifier,
    auth0Verifier: {
      async verify(token) {
        if (token !== auth0Token) throw new Error('Invalid proof');
        return identity;
      },
    },
  });
});
afterEach(async () => {
  await resetDatabase(project);
  firebase.tokens.clear();
});
afterAll(async () => {
  await app.close();
});
const getMe = (token = auth0Token) =>
  app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${token}` } });

describe('Auth0 REST identity resolution', () => {
  it('rejects Auth0 tokens when the feature is disabled, without Firebase fallback', async () => {
    firebase.tokens.set(auth0Token, {
      uid: 'must-not-provision',
      email: identity.email,
      emailVerified: true,
      name: null,
    });
    const disabled = await buildApp({ db, logger: false, authVerifier: firebase.verifier });
    try {
      const result = await disabled.inject({
        method: 'GET',
        url: '/me',
        headers: { authorization: `Bearer ${auth0Token}` },
      });
      expect(result.statusCode).toBe(401);
      expect((await usersCol(db).get()).empty).toBe(true);
    } finally {
      await disabled.close();
    }
  });
  it('does not fall back to Firebase after Auth0 verification fails', async () => {
    const invalid = auth0Token.replace('.signature', '.invalid-signature');
    firebase.tokens.set(invalid, {
      uid: 'must-not-provision',
      email: identity.email,
      emailVerified: true,
      name: null,
    });
    expect((await getMe(invalid)).statusCode).toBe(401);
    expect((await usersCol(db).get()).empty).toBe(true);
  });
  it('does not recreate a linked user whose record is removed during a profile update', async () => {
    await createTestUser(db, 'deleted-during-request', identity.email);
    await bindKnownIdentity(db, identity, 'deleted-during-request');
    const runTransaction = db.runTransaction.bind(db);
    vi.spyOn(db, 'runTransaction').mockImplementationOnce(async (fn, options) => {
      await usersCol(db).doc('deleted-during-request').delete();
      return runTransaction(fn, options);
    });
    try {
      expect((await getMe()).statusCode).toBe(403);
      expect((await usersCol(db).get()).empty).toBe(true);
      expect((await whiteboardsCol(db).get()).empty).toBe(true);
    } finally {
      vi.restoreAllMocks();
    }
  });
  it('refuses unlinked identities even when an existing email matches, without creating a user or board', async () => {
    await createTestUser(db, 'original-id', identity.email);
    const result = await getMe();
    expect(result.statusCode).toBe(403);
    expect(result.json().error).toBe('IDENTITY_NOT_LINKED');
    expect((await usersCol(db).get()).size).toBe(1);
    expect((await whiteboardsCol(db).get()).empty).toBe(true);
  });
  it('uses the linked user ID and preserves preferences', async () => {
    await createTestUser(db, 'original-id', identity.email, 'Existing');
    await usersCol(db).doc('original-id').update({ language: 'en', 'preferences.theme': 'dark' });
    await bindKnownIdentity(db, identity, 'original-id');
    const result = await getMe();
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({
      id: 'original-id',
      language: 'en',
      preferences: { theme: 'dark' },
    });
    expect((await usersCol(db).get()).size).toBe(1);
    expect((await whiteboardsCol(db).get()).empty).toBe(true);
  });
  it('refuses conflicting bindings and permits retries for the same account', async () => {
    await createTestUser(db, 'first', identity.email);
    await createTestUser(db, 'second', 'second@example.com');
    await bindKnownIdentity(db, identity, 'first');
    await bindKnownIdentity(db, identity, 'first');
    await expect(bindKnownIdentity(db, identity, 'second')).rejects.toMatchObject({
      code: 'IDENTITY_CONFLICT',
    });
    expect((await getMe()).json().id).toBe('first');
  });
  it('allows only one winner when bindings race', async () => {
    await createTestUser(db, 'first', identity.email);
    await createTestUser(db, 'second', 'second@example.com');
    const results = await Promise.allSettled(
      ['first', 'second'].map((id) => bindKnownIdentity(db, identity, id)),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await getMe()).statusCode).toBe(200);
  });
  it('rejects bindings to nonexistent users and does not recreate a removed user record', async () => {
    await expect(bindKnownIdentity(db, identity, 'missing')).rejects.toMatchObject({
      code: 'USER_NOT_FOUND',
    });
    await createTestUser(db, 'existing', identity.email);
    await bindKnownIdentity(db, identity, 'existing');
    await usersCol(db).doc('existing').delete();
    expect((await getMe()).statusCode).toBe(403);
    expect((await usersCol(db).get()).empty).toBe(true);
  });
  it('retains Firebase access and returns 401 for invalid credentials', async () => {
    firebase.tokens.set('firebase-token', {
      uid: 'firebase-user',
      email: identity.email,
      emailVerified: false,
      name: null,
    });
    expect((await getMe('firebase-token')).json().id).toBe('firebase-user');
    expect((await getMe('invalid-token')).statusCode).toBe(401);
  });
});
