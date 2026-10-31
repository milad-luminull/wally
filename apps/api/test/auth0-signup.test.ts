import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import type { VerifiedIdentity } from '../src/lib/auth/auth0.js';
import { bindKnownIdentity } from '../src/lib/auth/identities.js';
import {
  createFakeAuthVerifier,
  createTestUser,
  createTestBoard,
  createTestMembership,
  createTestDatabase,
  resetDatabase,
  type TestDatabase,
} from './helpers.js';
import type { Database } from '../src/lib/postgres/client.js';
import {
  authIdentities,
  boardMembers,
  users,
  whiteboards,
} from '../src/lib/postgres/schema/index.js';
let handle: TestDatabase;
let db: Database;
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
  handle = await createTestDatabase();
  db = handle.db;
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
beforeEach(async () => resetDatabase(db));
afterAll(async () => {
  await enabled?.close();
  await disabled?.close();
  await handle?.drop();
});
const userById = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0];
const boardById = async (id: string) =>
  (await db.select().from(whiteboards).where(eq(whiteboards.id, id)))[0];
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
    const member = async () =>
      (
        await db
          .select()
          .from(boardMembers)
          .where(and(eq(boardMembers.boardId, 'owner'), eq(boardMembers.id, memberId)))
      )[0];
    expect((await member())?.status).toBe('PENDING');
    identity.emailVerified = true;
    try {
      expect((await me()).statusCode).toBe(200);
      expect(await member()).toMatchObject({
        status: 'ACTIVE',
        userId: response.json().id,
      });
    } finally {
      identity.emailVerified = false;
    }
  });
  it('keeps a linked user ID and preferences when signup is enabled', async () => {
    await createTestUser(db, 'firebase-stable', 'new@example.com');
    await db
      .update(users)
      .set({ preferences: { theme: 'dark' } })
      .where(eq(users.id, 'firebase-stable'));
    await bindKnownIdentity(db, identity, 'firebase-stable');
    expect((await me()).json()).toMatchObject({
      id: 'firebase-stable',
      preferences: { theme: 'dark' },
    });
    expect(await db.$count(whiteboards)).toBe(0);
  });

  it('first Google login uses the prepared account and boards, but same-email subjects cannot', async () => {
    await createTestUser(db, 'google-original', 'new@example.com');
    await createTestBoard(db, 'google-original');
    const google = { issuer: identity.issuer, subject: 'google-oauth2|12345' };
    // Binding is idempotent for the same account.
    await bindKnownIdentity(db, google, 'google-original');
    await bindKnownIdentity(db, google, 'google-original');
    const responses = await Promise.all([me('google-oauth2|12345'), me('google-oauth2|12345')]);
    expect(responses.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(responses.every((r) => r.json().id === 'google-original')).toBe(true);
    expect((await me('google-oauth2|67890')).statusCode).toBe(403);
    expect((await me('auth0|same-email')).statusCode).toBe(403);
    expect(await db.$count(users)).toBe(1);
    expect((await db.select({ id: whiteboards.id }).from(whiteboards)).map((b) => b.id)).toEqual([
      'google-original',
    ]);
    expect((await boardById('google-original'))?.ownerId).toBe('google-original');
    await createTestUser(db, 'wrong-owner', 'other@example.com');
    await expect(bindKnownIdentity(db, google, 'wrong-owner')).rejects.toMatchObject({
      code: 'IDENTITY_CONFLICT',
    });
  });

  it('leaves unmapped accounts blocked by default', async () => {
    expect((await me(identity.subject, disabled)).statusCode).toBe(403);
    expect(await db.$count(users)).toBe(0);
  });
  it('atomically creates a fresh stable ID, initial board and mapping without marking email verified', async () => {
    const response = await me();
    expect(response.statusCode).toBe(200);
    const id = response.json().id as string;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const user = await userById(id);
    expect(user).toMatchObject({ email: 'new@example.com', emailVerified: false, language: 'en' });
    expect((await boardById(id))?.ownerId).toBe(id);
    expect(await db.$count(authIdentities)).toBe(1);
  });
  it('denies an existing email without linking or creating a board', async () => {
    await createTestUser(db, 'firebase-existing', 'new@example.com');
    const response = await me();
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe('IDENTITY_NOT_LINKED');
    expect(await db.$count(users)).toBe(1);
    expect(await db.$count(authIdentities)).toBe(0);
    expect(await db.$count(whiteboards)).toBe(0);
  });
  it('concurrent requests from one subject create one account and one board', async () => {
    const responses = await Promise.all([me(), me()]);
    expect(responses.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(responses[0]!.json().id).toBe(responses[1]!.json().id);
    expect(await db.$count(users)).toBe(1);
    expect(await db.$count(whiteboards)).toBe(1);
  });
  it('concurrent different subjects with the same email cannot create duplicate accounts', async () => {
    const responses = await Promise.all([me('auth0|first'), me('google-oauth2|second')]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 403]);
    expect(await db.$count(users)).toBe(1);
    expect(await db.$count(authIdentities)).toBe(1);
  });
  it('never recreates a linked user whose record is gone, even with signup enabled', async () => {
    await createTestUser(db, 'deleted', 'new@example.com');
    await bindKnownIdentity(db, identity, 'deleted');
    // The mapping cascades with its user, so a user can only be missing behind a mapping when
    // it is removed mid-request: after the identity resolved (the first transaction) and
    // before the profile update (the second).
    const transaction = db.transaction.bind(db);
    vi.spyOn(db, 'transaction')
      .mockImplementationOnce((fn, config) => transaction(fn, config))
      .mockImplementationOnce(async (fn, config) => {
        await db.delete(users).where(eq(users.id, 'deleted'));
        return transaction(fn, config);
      });
    try {
      expect((await me()).statusCode).toBe(403);
    } finally {
      vi.restoreAllMocks();
    }
    expect(await db.$count(users)).toBe(0);
    expect(await db.$count(whiteboards)).toBe(0);
  });
});
