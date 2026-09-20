import type { FastifyInstance } from 'fastify';
import type { Firestore } from 'firebase-admin/firestore';
import { DEFAULT_LANGUAGE, INITIAL_BOARD_NAME } from '@wally/shared';
import type { Language, MembershipStatus, WhiteboardRole } from '@wally/shared';
import type { UserDoc } from '../src/lib/db/types.js';
import { buildApp } from '../src/app.js';
import { createNamedDb } from '../src/lib/db/client.js';
import {
  membersCol,
  normalizeEmail,
  now,
  shareLinksCol,
  usersCol,
  whiteboardsCol,
} from '../src/lib/db/collections.js';
import type { AuthVerifier, DecodedAuthToken } from '../src/plugins/firebase.js';

/**
 * A fake token->identity map used by integration tests instead of real Firebase ID
 * tokens. Call `.set('token-for-max', { uid, email, name })` then send
 * `Authorization: Bearer token-for-max` in `.inject()` calls.
 */
export function createFakeAuthVerifier(): { verifier: AuthVerifier; tokens: Map<string, DecodedAuthToken> } {
  const tokens = new Map<string, DecodedAuthToken>();
  const verifier: AuthVerifier = {
    async verifyIdToken(token: string) {
      const user = tokens.get(token);
      if (!user) throw new Error('invalid token');
      return user;
    },
  };
  return { verifier, tokens };
}

const instances = new Map<string, Firestore>();

/**
 * One Firestore per test file, on its own emulator project id.
 *
 * The emulator keeps each project's data separate, so files that pass different ids can
 * run concurrently without fighting over the same fixture documents — which is what the
 * Postgres-era suites needed `fileParallelism: false` to avoid.
 */
export function getTestDb(projectId: string): Firestore {
  let db = instances.get(projectId);
  if (!db) {
    db = createNamedDb(projectId);
    instances.set(projectId, db);
  }
  return db;
}

/** Wipes a project's documents via the emulator's own clear endpoint. */
export async function resetDatabase(projectId: string): Promise<void> {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error('FIRESTORE_EMULATOR_HOST must be set to run these tests');

  const response = await fetch(
    `http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
  if (!response.ok) {
    throw new Error(`Failed to clear emulator data for ${projectId}: ${response.status}`);
  }
}

export interface TestContext {
  app: FastifyInstance;
  db: Firestore;
  projectId: string;
  tokens: Map<string, DecodedAuthToken>;
  authHeader(token: string): { authorization: string };
}

export async function buildTestApp(projectId: string): Promise<TestContext> {
  const db = getTestDb(projectId);
  const { verifier, tokens } = createFakeAuthVerifier();
  const app = await buildApp({ db, authVerifier: verifier, logger: false });
  await app.ready();
  return {
    app,
    db,
    projectId,
    tokens,
    authHeader: (token: string) => ({ authorization: `Bearer ${token}` }),
  };
}

/**
 * Registers a fake user identity and returns the bearer token to use for it.
 * `emailVerified` defaults to true (a normal fixture user) — pass false to simulate an
 * attacker who signed up claiming someone else's email without confirming it.
 */
export function registerTestUser(
  ctx: TestContext,
  uid: string,
  email: string,
  name: string | null = null,
  emailVerified = true,
): string {
  const token = `token-${uid}`;
  ctx.tokens.set(token, { uid, email, emailVerified, name });
  return token;
}

/**
 * Adds an ACTIVE membership the way production does — the member document and the
 * board's `memberRoles` cache together, so authorization sees it.
 */
export async function addTestMember(
  db: Firestore,
  whiteboardId: string,
  userId: string,
  role: WhiteboardRole,
): Promise<string> {
  const timestamp = now();
  const ref = membersCol(db, whiteboardId).doc();
  const batch = db.batch();
  batch.set(ref, {
    whiteboardId,
    userId,
    invitedEmail: null,
    role,
    status: 'ACTIVE',
    invitedAt: timestamp,
    activatedAt: timestamp,
  });
  batch.update(whiteboardsCol(db).doc(whiteboardId), {
    [`memberRoles.${userId}`]: role,
    updatedAt: timestamp,
  });
  await batch.commit();
  return ref.id;
}

export async function createTestUser(
  db: Firestore,
  id: string,
  email: string,
  displayName: string | null = null,
  emailVerified = true,
  /**
   * Pass 'absent' to omit the language field entirely, reproducing a profile written before
   * that field existed — what the legacy-profile test needs without dropping to a raw write.
   *
   * A sentinel rather than plain `undefined` because a default parameter fires on an
   * explicitly passed `undefined` too, so `createTestUser(..., undefined)` would silently
   * write DEFAULT_LANGUAGE and quietly defeat the test.
   */
  language: Language | 'absent' = DEFAULT_LANGUAGE,
): Promise<string> {
  const timestamp = now();
  // Cast because the 'absent' case deliberately builds a document that is NOT a valid
  // UserDoc — that is the whole point of the fixture.
  await usersCol(db).doc(id).set({
    email: normalizeEmail(email),
    displayName,
    emailVerified,
    ...(language === 'absent' ? {} : { language }),
    createdAt: timestamp,
    updatedAt: timestamp,
  } as UserDoc);
  return id;
}

/** A board owned by `ownerId`, keyed by that uid the way production provisions it. */
export async function createTestBoard(
  db: Firestore,
  ownerId: string,
  memberRoles: Record<string, WhiteboardRole> = {},
): Promise<string> {
  const timestamp = now();
  await whiteboardsCol(db).doc(ownerId).set({
    name: INITIAL_BOARD_NAME.de,
    ownerId,
    memberRoles,
    shareLinkToken: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return ownerId;
}

/**
 * A membership written directly, including the shapes production only reaches through a
 * workflow — a PENDING email invite, or a member deliberately left out of `memberRoles`.
 */
export async function createTestMembership(
  db: Firestore,
  whiteboardId: string,
  member: {
    userId?: string | null;
    invitedEmail?: string | null;
    role: WhiteboardRole;
    status: MembershipStatus;
  },
): Promise<string> {
  const timestamp = now();
  const ref = membersCol(db, whiteboardId).doc();
  await ref.set({
    whiteboardId,
    userId: member.userId ?? null,
    invitedEmail: member.invitedEmail ? normalizeEmail(member.invitedEmail) : null,
    role: member.role,
    status: member.status,
    invitedAt: timestamp,
    activatedAt: member.status === 'ACTIVE' ? timestamp : null,
  });
  return ref.id;
}


export async function createTestShareLink(
  db: Firestore,
  token: string,
  whiteboardId: string,
  role: WhiteboardRole,
): Promise<string> {
  const timestamp = now();
  const batch = db.batch();
  batch.set(shareLinksCol(db).doc(token), {
    whiteboardId,
    role,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  batch.update(whiteboardsCol(db).doc(whiteboardId), {
    shareLinkToken: token,
    updatedAt: timestamp,
  });
  await batch.commit();
  return token;
}

/**
 * Standard fixture for route-matrix integration tests: an owner, an ACTIVE EDIT member,
 * an ACTIVE VIEW member, and an outsider with no relationship to the board at all. Each
 * identity is both registered with the fake auth verifier (so its token authenticates)
 * and driven through one request (so the auth preHandler provisions its user record and
 * its own whiteboard).
 */
export async function createBoardFixture(ctx: TestContext) {
  const ownerToken = registerTestUser(ctx, 'fx-owner', 'owner@fixture.de', 'Owner');
  const editToken = registerTestUser(ctx, 'fx-editor', 'editor@fixture.de', 'Editor');
  const viewToken = registerTestUser(ctx, 'fx-viewer', 'viewer@fixture.de', 'Viewer');
  const outsiderToken = registerTestUser(ctx, 'fx-outsider', 'outsider@fixture.de', 'Outsider');

  for (const token of [ownerToken, editToken, viewToken, outsiderToken]) {
    await ctx.app.inject({ method: 'GET', url: '/whiteboards', headers: ctx.authHeader(token) });
  }

  // A board's document id is its owner's uid, so the owner's board needs no lookup.
  const boardId = 'fx-owner';
  const editMemberId = await addTestMember(ctx.db, boardId, 'fx-editor', 'EDIT');
  const viewMemberId = await addTestMember(ctx.db, boardId, 'fx-viewer', 'VIEW');

  return {
    boardId,
    ownerToken,
    editToken,
    viewToken,
    outsiderToken,
    ownerId: 'fx-owner',
    editorId: 'fx-editor',
    viewerId: 'fx-viewer',
    editMemberId,
    viewMemberId,
  };
}
