import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { eq } from 'drizzle-orm';
import {
  MAX_REMEMBERED_BOARDS,
  accountExportSchema,
  meDtoSchema,
  meUpdateSchema,
} from '@wally/shared';
import { userPreferences } from '../lib/db/records.js';
import type { StoredPreferences } from '../lib/db/types.js';
import { toMeDto } from '../lib/dto.js';
import { AppError } from '../lib/errors.js';
import { withTransaction } from '../lib/postgres/transaction.js';
import { users } from '../lib/postgres/schema/index.js';
import { accountIdentity, eraseAccount } from '../lib/account/erase.js';
import { exportAccount } from '../lib/account/export.js';
import type { Auth0UserDeleter } from '../lib/auth/management.js';

/**
 * The caller's own profile. Authenticated but not board-scoped: the global auth preHandler
 * already establishes identity and there is no whiteboard in the picture, so neither
 * requireWhiteboardAccess nor requireRole applies here.
 *
 * The row these routes touch is the caller's user, and the id comes from the verified token
 * rather than from the request — so a caller can only ever address their own profile, and
 * there is no id to authorize.
 */
export default async function meRoutes(
  fastify: FastifyInstance,
  options: { auth0UserDeleter?: Auth0UserDeleter | null },
) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // Zero reads: the auth preHandler already read the user on this very request and
  // decorated it onto request.user.
  app.get('/me', { schema: { response: { 200: meDtoSchema } } }, async (request) => {
    return toMeDto(request.user);
  });

  app.patch(
    '/me',
    { schema: { body: meUpdateSchema, response: { 200: meDtoSchema } } },
    async (request) => {
      const { language, preferences } = request.body;

      // A transaction: pruning remembered boards needs their stored touchedAt, which
      // request.user deliberately doesn't carry.
      const stored = await withTransaction(request.server.db, async (tx) => {
        const [current] = await tx
          .select({ language: users.language, preferences: users.preferences })
          .from(users)
          .where(eq(users.id, request.user.id));
        // A profile deleted between the preHandler and here.
        if (!current) throw new AppError(404, 'NOT_FOUND', 'Not found');

        // Only the preferences the request names change; a per-board write leaves the other
        // boards, the theme and the language exactly as they were.
        const next: StoredPreferences = { ...current.preferences };
        if (preferences?.palette !== undefined) next.palette = preferences.palette;
        if (preferences?.theme !== undefined) next.theme = preferences.theme;
        if (preferences?.canvas !== undefined) next.canvas = preferences.canvas;
        if (preferences?.lastBoardId !== undefined) next.lastBoardId = preferences.lastBoardId;
        if (preferences?.wallybot !== undefined) next.wallybot = preferences.wallybot;

        const boards = { ...(current.preferences.boards ?? {}) };
        const touchedAt = Date.now();
        for (const [boardId, value] of Object.entries(preferences?.boards ?? {})) {
          if (value === null) delete boards[boardId];
          else boards[boardId] = { ...value, touchedAt };
        }
        const overflow = Object.entries(boards)
          .sort(([, a], [, b]) => (a.touchedAt ?? 0) - (b.touchedAt ?? 0))
          .slice(0, Math.max(0, Object.keys(boards).length - MAX_REMEMBERED_BOARDS));
        for (const [boardId] of overflow) delete boards[boardId];
        next.boards = boards;

        const nextLanguage = language ?? current.language;
        await tx
          .update(users)
          .set({ language: nextLanguage, preferences: next, updatedAt: new Date() })
          .where(eq(users.id, request.user.id));
        return { language: nextLanguage, preferences: userPreferences({ preferences: next }) };
      });

      return toMeDto({ ...request.user, ...stored });
    },
  );

  /** Everything the caller can see, as one JSON file (GDPR Art. 15 and 20). */
  app.get(
    '/me/export',
    { schema: { response: { 200: accountExportSchema } } },
    async (request, reply) => {
      const data = await exportAccount(request.server.db, request.user);
      return reply
        .header(
          'content-disposition',
          `attachment; filename="wally-export-${data.exportedAt.slice(0, 10)}.json"`,
        )
        .send(data);
    },
  );

  /**
   * Deletes the caller's account at once (the account deletion design). The Auth0 user goes
   * first, outside any transaction, so the transaction's retries never call Auth0 twice; if it
   * fails nothing is erased. If the database step then fails, the person can no longer sign
   * in and the owner finishes the deletion by hand (docs/DEPLOY.md), from the logged user id.
   */
  app.delete('/me', async (request, reply) => {
    const userId = request.user.id;
    const identity = await accountIdentity(request.server.db, userId);
    let auth0Deleted = false;
    if (options.auth0UserDeleter && identity) {
      try {
        await options.auth0UserDeleter.deleteUser(identity.subject);
        auth0Deleted = true;
      } catch (error) {
        request.log.error({ err: error, userId }, 'auth0 user deletion failed');
        throw new AppError(
          502,
          'ACCOUNT_DELETE_FAILED',
          'The account could not be deleted. Try again.',
        );
      }
    } else {
      request.log.info({ userId }, 'auth0 step skipped');
    }
    try {
      await eraseAccount(request.server.db, userId, identity);
    } catch (error) {
      request.log.error({ err: error, userId, auth0Deleted }, 'account erase failed');
      throw error;
    }
    return reply.code(204).send();
  });
}
