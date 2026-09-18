import { PrismaClient } from '../src/lib/prisma-client.js';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
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

let sharedPrisma: PrismaClient | undefined;

/** One PrismaClient shared across a test file's suite, pointed at DATABASE_URL. */
export function getTestPrisma(): PrismaClient {
  sharedPrisma ??= new PrismaClient();
  return sharedPrisma;
}

/** Deletes all Users (cascades boards/members/notes/subtasks/history) + reference options. */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.user.deleteMany();
  await prisma.referenceOption.deleteMany();
}

export interface TestContext {
  app: FastifyInstance;
  prisma: PrismaClient;
  tokens: Map<string, DecodedAuthToken>;
  authHeader(token: string): { authorization: string };
}

export async function buildTestApp(): Promise<TestContext> {
  const prisma = getTestPrisma();
  const { verifier, tokens } = createFakeAuthVerifier();
  const app = await buildApp({ prismaClient: prisma, authVerifier: verifier, logger: false });
  await app.ready();
  return {
    app,
    prisma,
    tokens,
    authHeader: (token: string) => ({ authorization: `Bearer ${token}` }),
  };
}

/** Registers a fake user identity and returns the bearer token to use for it. */
export function registerTestUser(
  ctx: TestContext,
  uid: string,
  email: string,
  name: string | null = null,
): string {
  const token = `token-${uid}`;
  ctx.tokens.set(token, { uid, email, name });
  return token;
}

/**
 * Standard fixture for route-matrix integration tests: an owner, an ACTIVE EDIT member,
 * an ACTIVE VIEW member, and an outsider with no relationship to the board at all. Each
 * identity is both registered with the fake auth verifier (so its token authenticates)
 * and given a real DB User row (so it can be referenced by FKs).
 */
export async function createBoardFixture(ctx: TestContext) {
  const ownerToken = registerTestUser(ctx, 'fx-owner', 'owner@fixture.de', 'Owner');
  const editToken = registerTestUser(ctx, 'fx-editor', 'editor@fixture.de', 'Editor');
  const viewToken = registerTestUser(ctx, 'fx-viewer', 'viewer@fixture.de', 'Viewer');
  const outsiderToken = registerTestUser(ctx, 'fx-outsider', 'outsider@fixture.de', 'Outsider');

  // Authenticating once (via a lightweight request) triggers the auth preHandler's
  // upsert-user + lazily-provision-whiteboard logic for each identity.
  for (const token of [ownerToken, editToken, viewToken, outsiderToken]) {
    await ctx.app.inject({ method: 'GET', url: '/whiteboards', headers: ctx.authHeader(token) });
  }

  const owner = await ctx.prisma.user.findUniqueOrThrow({ where: { id: 'fx-owner' } });
  const editor = await ctx.prisma.user.findUniqueOrThrow({ where: { id: 'fx-editor' } });
  const viewer = await ctx.prisma.user.findUniqueOrThrow({ where: { id: 'fx-viewer' } });

  const board = await ctx.prisma.whiteboard.findUniqueOrThrow({ where: { ownerId: owner.id } });

  await ctx.prisma.whiteboardMember.create({
    data: { whiteboardId: board.id, userId: editor.id, role: 'EDIT', status: 'ACTIVE' },
  });
  await ctx.prisma.whiteboardMember.create({
    data: { whiteboardId: board.id, userId: viewer.id, role: 'VIEW', status: 'ACTIVE' },
  });

  return {
    boardId: board.id,
    ownerToken,
    editToken,
    viewToken,
    outsiderToken,
    ownerId: owner.id,
    editorId: editor.id,
    viewerId: viewer.id,
  };
}
