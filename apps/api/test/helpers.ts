import { randomUUID } from 'node:crypto';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { DEFAULT_LANGUAGE, INITIAL_BOARD_NAME } from '@wally/shared';
import type { Language, MembershipStatus, WhiteboardRole } from '@wally/shared';
import { buildApp, type BuildAppOptions } from '../src/app.js';
import { newId } from '../src/lib/db/ids.js';
import { normalizeEmail } from '../src/lib/db/records.js';
import type { AuthVerifier, DecodedAuthToken } from '../src/plugins/firebase.js';
import type { Database } from '../src/lib/postgres/client.js';
import {
  boardMembers,
  notes,
  shareLinks,
  users,
  whiteboards,
} from '../src/lib/postgres/schema/index.js';
import { createTestDatabase } from './postgres.js';

export { createTestDatabase, type TestDatabase } from './postgres.js';

/**
 * A fake token->identity map used by integration tests instead of real Firebase ID
 * tokens. Call `.set('token-for-max', { uid, email, name })` then send
 * `Authorization: Bearer token-for-max` in `.inject()` calls.
 */
export function createFakeAuthVerifier(): {
  verifier: AuthVerifier;
  tokens: Map<string, DecodedAuthToken>;
} {
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

/** Every application table, emptied between tests. */
const TABLES = [
  'users',
  'whiteboards',
  'board_operations',
  'board_cleanup',
  'assistant_audit',
  'assistant_spend',
];

/**
 * Empties this file's database. Everything else cascades from users and whiteboards; the
 * tables without foreign keys are named explicitly.
 */
export async function resetDatabase(db: Database): Promise<void> {
  await db.execute(sql.raw(`truncate ${TABLES.join(', ')} cascade`));
}

export interface TestContext {
  app: FastifyInstance;
  /** Normal client contract; use app.inject directly to test missing/stale metadata. */
  inject(options: InjectOptions): Promise<LightMyRequestResponse>;
  /** This file's own database, dropped when the app closes. */
  db: Database;
  tokens: Map<string, DecodedAuthToken>;
  authHeader(token: string): { authorization: string };
}

export async function buildTestApp(
  options: Pick<
    BuildAppOptions,
    | 'assistantRunner'
    | 'suggestionRunner'
    | 'tidyRunner'
    | 'assistantEnabled'
    | 'assistantDeadlineMs'
  > & {
    /** Collects the app's log lines (one JSON object each) instead of discarding them. */
    logLines?: string[];
  } = {},
): Promise<TestContext> {
  const { verifier, tokens } = createFakeAuthVerifier();
  const { logLines, ...appOptions } = options;
  const database = await createTestDatabase();
  const db = database.db;
  const app = await buildApp({
    ...appOptions,
    db,
    authVerifier: verifier,
    logger: false,
    ...(logLines ? { logStream: { write: (line: string) => void logLines.push(line) } } : {}),
  });
  app.addHook('onClose', () => database.drop());
  await app.ready();
  return {
    app,
    async inject(options) {
      const url = typeof options.url === 'string' ? options.url : (options.url?.pathname ?? '/');
      const method = String(options.method ?? 'GET').toUpperCase();
      if (method === 'GET' || url === '/me' || url === '/health') return app.inject(options);
      const parts = url.split('/');
      let revision: number | undefined;
      if (parts[1] === 'notes')
        revision =
          (
            await db.select({ revision: notes.revision }).from(notes).where(eq(notes.id, parts[2]!))
          )[0]?.revision ?? 0;
      // POST /whiteboards (board.create) names no board and takes no expected revision.
      else if (parts[1] === 'whiteboards' && parts[2])
        revision =
          (
            await db
              .select({ revision: whiteboards.revision })
              .from(whiteboards)
              .where(eq(whiteboards.id, parts[2]!))
          )[0]?.revision ?? 0;
      return app.inject({
        ...options,
        headers: {
          'idempotency-key': randomUUID(),
          ...(revision === undefined ? {} : { 'x-expected-revision': String(revision) }),
          ...options.headers,
        },
      });
    },
    db,
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

/** Adds an ACTIVE membership, the way an accepted invite leaves it. */
export async function addTestMember(
  db: Database,
  whiteboardId: string,
  userId: string,
  role: WhiteboardRole,
): Promise<string> {
  return createTestMembership(db, whiteboardId, { userId, role, status: 'ACTIVE' });
}

export async function createTestUser(
  db: Database,
  id: string,
  email: string,
  displayName: string | null = null,
  emailVerified = true,
  language: Language = DEFAULT_LANGUAGE,
): Promise<string> {
  const timestamp = new Date();
  await db.insert(users).values({
    id,
    email: normalizeEmail(email),
    displayName,
    emailVerified,
    language,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return id;
}

/**
 * A board owned by `ownerId`, keyed by that uid the way production provisions it, with an
 * ACTIVE membership for each entry of `memberRoles`.
 */
export async function createTestBoard(
  db: Database,
  ownerId: string,
  memberRoles: Record<string, WhiteboardRole> = {},
): Promise<string> {
  const timestamp = new Date();
  await db.insert(whiteboards).values({
    id: ownerId,
    name: INITIAL_BOARD_NAME.de,
    ownerId,
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  for (const [userId, role] of Object.entries(memberRoles))
    await addTestMember(db, ownerId, userId, role);
  return ownerId;
}

/**
 * A membership written directly, including the shapes production only reaches through a
 * workflow — a PENDING email invite, say.
 */
export async function createTestMembership(
  db: Database,
  whiteboardId: string,
  member: {
    userId?: string | null;
    invitedEmail?: string | null;
    role: WhiteboardRole;
    status: MembershipStatus;
  },
): Promise<string> {
  const timestamp = new Date();
  const id = newId();
  await db.insert(boardMembers).values({
    id,
    boardId: whiteboardId,
    userId: member.userId ?? null,
    invitedEmail: member.invitedEmail ? normalizeEmail(member.invitedEmail) : null,
    role: member.role,
    status: member.status,
    invitedAt: timestamp,
    activatedAt: member.status === 'ACTIVE' ? timestamp : null,
  });
  return id;
}

export async function createTestShareLink(
  db: Database,
  token: string,
  whiteboardId: string,
  role: WhiteboardRole,
): Promise<string> {
  const timestamp = new Date();
  await db
    .insert(shareLinks)
    .values({ token, boardId: whiteboardId, role, createdAt: timestamp, updatedAt: timestamp });
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
