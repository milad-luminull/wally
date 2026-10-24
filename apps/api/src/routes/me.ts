import { assertAccountActive } from '../lib/account/access.js';
import { listBoards } from '../lib/commands/queries.js';
import { z } from 'zod';
import { requestAccountDeletion } from '../lib/account/deletion.js';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { FieldValue, type UpdateData } from 'firebase-admin/firestore';
import { MAX_REMEMBERED_BOARDS, meDtoSchema, meUpdateSchema } from '@wally/shared';
import { now, userLanguage, userPreferences, usersCol } from '../lib/db/collections.js';
import type { UserDoc } from '../lib/db/types.js';
import { toMeDto } from '../lib/dto.js';
import { exportAccount } from '../lib/account/export.js';

/**
 * The caller's own profile. Authenticated but not board-scoped: the global auth preHandler
 * already establishes identity and there is no whiteboard in the picture, so neither
 * requireWhiteboardAccess nor requireRole applies here.
 *
 * The document these routes touch is users/{uid}, and the uid comes from the verified token
 * rather than from the request — so a caller can only ever address their own profile, and
 * there is no id to authorize.
 */
export default async function meRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // Zero Firestore reads: the auth preHandler already read users/{uid} on this very request
  // and decorated it onto request.user.
  app.get('/me', { schema: { response: { 200: meDtoSchema } } }, async (request) => {
    return toMeDto(request.user);
  });

  app.get('/me/export', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('Content-Disposition', 'attachment; filename="wally-account.json"');
    return exportAccount(app.db, request.user);
  });

  app.get('/me/deletion', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return {
      ownedBoards: (await listBoards(app.db, request.user)).filter(
        (board) => board.currentUserRole === 'OWNER',
      ),
      recentAuthentication:
        typeof request.user.authenticatedAt === 'number' &&
        Date.now() / 1000 - request.user.authenticatedAt <= 300,
    };
  });

  app.delete(
    '/me',
    { schema: { body: z.object({ confirmation: z.literal('DELETE') }).strict() } },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const result = await requestAccountDeletion(app.db, request.user);
      return reply.code(202).send(result);
    },
  );

  app.patch(
    '/me',
    { schema: { body: meUpdateSchema, response: { 200: meDtoSchema } } },
    async (request) => {
      const { language, preferences } = request.body;
      const userRef = usersCol(request.server.db).doc(request.user.id);

      // A transaction rather than a blind update(): pruning remembered boards needs their
      // stored touchedAt, which request.user deliberately doesn't carry.
      const stored = await request.server.db.runTransaction(async (tx) => {
        await assertAccountActive(app.db, request.user.id, tx);
        const snapshot = await tx.get(userRef);
        const current = snapshot.data();
        // update(), not set(): email/displayName/emailVerified are Firebase's to own and
        // provisioning writes them. A profile deleted between the preHandler and here raises
        // gRPC NOT_FOUND, which app.ts's error handler already turns into a 404.
        //
        // Every preference is written by its own dotted path, so a per-board write leaves the
        // other boards, the theme and the language exactly as they were.
        const update: Record<string, unknown> = { updatedAt: now() };
        if (language !== undefined) update.language = language;
        if (preferences?.palette !== undefined) update['preferences.palette'] = preferences.palette;
        if (preferences?.theme !== undefined) update['preferences.theme'] = preferences.theme;
        if (preferences?.canvas !== undefined) update['preferences.canvas'] = preferences.canvas;
        if (preferences?.lastBoardId !== undefined) {
          update['preferences.lastBoardId'] = preferences.lastBoardId;
        }
        if (preferences?.wallybot !== undefined)
          update['preferences.wallybot'] = preferences.wallybot;

        const boards = { ...(current?.preferences?.boards ?? {}) };
        const touchedAt = Date.now();
        for (const [boardId, value] of Object.entries(preferences?.boards ?? {})) {
          if (value === null) {
            update[`preferences.boards.${boardId}`] = FieldValue.delete();
            delete boards[boardId];
          } else {
            update[`preferences.boards.${boardId}`] = { ...value, touchedAt };
            boards[boardId] = { ...value, touchedAt };
          }
        }
        const overflow = Object.entries(boards)
          .sort(([, a], [, b]) => (a.touchedAt ?? 0) - (b.touchedAt ?? 0))
          .slice(0, Math.max(0, Object.keys(boards).length - MAX_REMEMBERED_BOARDS));
        for (const [boardId] of overflow) {
          update[`preferences.boards.${boardId}`] = FieldValue.delete();
          delete boards[boardId];
        }

        tx.update(userRef, update as UpdateData<UserDoc>);
        return {
          language: language ?? userLanguage(current),
          preferences: userPreferences({
            preferences: {
              ...current?.preferences,
              ...(preferences?.palette !== undefined && { palette: preferences.palette }),
              ...(preferences?.theme !== undefined && { theme: preferences.theme }),
              ...(preferences?.canvas !== undefined && { canvas: preferences.canvas }),
              ...(preferences?.lastBoardId !== undefined && {
                lastBoardId: preferences.lastBoardId,
              }),
              ...(preferences?.wallybot !== undefined && { wallybot: preferences.wallybot }),
              boards,
            },
          }),
        };
      });

      return toMeDto({ ...request.user, ...stored });
    },
  );
}
