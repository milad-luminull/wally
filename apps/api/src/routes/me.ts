import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { eq } from 'drizzle-orm';
import { MAX_REMEMBERED_BOARDS, meDtoSchema, meUpdateSchema } from '@wally/shared';
import { userPreferences } from '../lib/db/records.js';
import type { StoredPreferences } from '../lib/db/types.js';
import { toMeDto } from '../lib/dto.js';
import { AppError } from '../lib/errors.js';
import { withTransaction } from '../lib/postgres/transaction.js';
import { users } from '../lib/postgres/schema/index.js';

/**
 * The caller's own profile. Authenticated but not board-scoped: the global auth preHandler
 * already establishes identity and there is no whiteboard in the picture, so neither
 * requireWhiteboardAccess nor requireRole applies here.
 *
 * The row these routes touch is the caller's user, and the id comes from the verified token
 * rather than from the request — so a caller can only ever address their own profile, and
 * there is no id to authorize.
 */
export default async function meRoutes(fastify: FastifyInstance) {
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
}
