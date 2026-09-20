import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { meDtoSchema, meUpdateSchema } from '@wally/shared';
import { now, usersCol } from '../lib/db/collections.js';
import { toMeDto } from '../lib/dto.js';

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

  app.patch(
    '/me',
    { schema: { body: meUpdateSchema, response: { 200: meDtoSchema } } },
    async (request) => {
      const { language } = request.body;
      // update(), not set(): email/displayName/emailVerified are Firebase's to own and
      // provisioning writes them. A profile deleted between the preHandler and here raises
      // gRPC NOT_FOUND, which app.ts's error handler already turns into a 404.
      await usersCol(request.server.db).doc(request.user.id).update({ language, updatedAt: now() });
      return toMeDto({ ...request.user, language });
    },
  );
}
