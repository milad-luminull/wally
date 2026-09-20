import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  shareLinkDtoSchema,
  shareLinkRedeemResultSchema,
  shareLinkRoleSchema,
} from '@wally/shared';
import type { ShareLinkDoc, WithId } from '../lib/db/types.js';
import { now, shareLinksCol, whiteboardsCol, withId } from '../lib/db/collections.js';
import { requireRole, requireWhiteboardAccess } from '../lib/authorization.js';
import { toShareLinkDto } from '../lib/dto.js';
import { AppError } from '../lib/errors.js';
import { redeemShareLink } from '../lib/members.js';
import { generateShareToken } from '../lib/tokens.js';
import { loadEnv } from '../env.js';

const whiteboardIdParams = z.object({ id: z.string() });
const tokenParams = z.object({ token: z.string() });

/** The board mirrors its current token, so the link is reachable without a query. */
function requireToken(board: { shareLinkToken: string | null }): string {
  if (!board.shareLinkToken) throw new AppError(404, 'NOT_FOUND', 'No share link');
  return board.shareLinkToken;
}

export default async function shareLinkRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const baseUrl = loadEnv().CORS_ORIGIN;

  app.get(
    '/whiteboards/:id/share-link',
    {
      preHandler: [requireWhiteboardAccess({ kind: 'whiteboardParam' }), requireRole(['OWNER'])],
      schema: { params: whiteboardIdParams, response: { 200: shareLinkDtoSchema } },
    },
    async (request) => {
      const shareLink = withId(
        await shareLinksCol(request.server.db)
          .doc(requireToken(request.whiteboardContext!.board))
          .get(),
      );
      if (!shareLink) throw new AppError(404, 'NOT_FOUND', 'No share link');
      return toShareLinkDto(shareLink, baseUrl);
    },
  );

  app.post(
    '/whiteboards/:id/share-link',
    {
      preHandler: [requireWhiteboardAccess({ kind: 'whiteboardParam' }), requireRole(['OWNER'])],
      schema: {
        params: whiteboardIdParams,
        body: shareLinkRoleSchema,
        response: { 201: shareLinkDtoSchema },
      },
    },
    async (request, reply) => {
      const ctx = request.whiteboardContext!;
      const db = request.server.db;
      if (ctx.board.shareLinkToken) {
        throw new AppError(409, 'SHARE_LINK_EXISTS', 'A share link already exists for this board');
      }

      const token = generateShareToken();
      const timestamp = now();
      const shareLink: ShareLinkDoc = {
        whiteboardId: ctx.whiteboardId,
        role: request.body.role,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      const batch = db.batch();
      batch.set(shareLinksCol(db).doc(token), shareLink);
      batch.update(whiteboardsCol(db).doc(ctx.whiteboardId), {
        shareLinkToken: token,
        updatedAt: timestamp,
      });
      await batch.commit();

      reply.code(201);
      return toShareLinkDto({ ...shareLink, id: token }, baseUrl);
    },
  );

  app.patch(
    '/whiteboards/:id/share-link',
    {
      preHandler: [requireWhiteboardAccess({ kind: 'whiteboardParam' }), requireRole(['OWNER'])],
      schema: {
        params: whiteboardIdParams,
        body: shareLinkRoleSchema,
        response: { 200: shareLinkDtoSchema },
      },
    },
    async (request) => {
      const db = request.server.db;
      const token = requireToken(request.whiteboardContext!.board);
      const existing = withId(await shareLinksCol(db).doc(token).get());
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'No share link');

      const role = request.body.role;
      const updatedAt = now();
      await shareLinksCol(db).doc(token).update({ role, updatedAt });

      return toShareLinkDto({ ...existing, role, updatedAt }, baseUrl);
    },
  );

  app.delete(
    '/whiteboards/:id/share-link',
    {
      preHandler: [requireWhiteboardAccess({ kind: 'whiteboardParam' }), requireRole(['OWNER'])],
      schema: { params: whiteboardIdParams },
    },
    async (request, reply) => {
      const ctx = request.whiteboardContext!;
      const db = request.server.db;
      const token = requireToken(request.whiteboardContext!.board);

      const batch = db.batch();
      batch.delete(shareLinksCol(db).doc(token));
      batch.update(whiteboardsCol(db).doc(ctx.whiteboardId), {
        shareLinkToken: null,
        updatedAt: now(),
      });
      await batch.commit();

      return reply.code(204).send();
    },
  );

  app.post(
    '/whiteboards/:id/share-link/rotate',
    {
      preHandler: [requireWhiteboardAccess({ kind: 'whiteboardParam' }), requireRole(['OWNER'])],
      schema: { params: whiteboardIdParams, response: { 200: shareLinkDtoSchema } },
    },
    async (request) => {
      const ctx = request.whiteboardContext!;
      const db = request.server.db;
      const oldToken = requireToken(request.whiteboardContext!.board);
      const existing = withId(await shareLinksCol(db).doc(oldToken).get());
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'No share link');

      // The token IS the document id, so rotating moves the document rather than editing
      // a column — which is also what makes the old URL stop resolving.
      const token = generateShareToken();
      const updatedAt = now();
      const rotated: WithId<ShareLinkDoc> = { ...existing, id: token, updatedAt };

      const batch = db.batch();
      batch.delete(shareLinksCol(db).doc(oldToken));
      batch.set(shareLinksCol(db).doc(token), {
        whiteboardId: existing.whiteboardId,
        role: existing.role,
        createdAt: existing.createdAt,
        updatedAt,
      });
      batch.update(whiteboardsCol(db).doc(ctx.whiteboardId), {
        shareLinkToken: token,
        updatedAt,
      });
      await batch.commit();

      return toShareLinkDto(rotated, baseUrl);
    },
  );

  // Redemption is not whiteboard-scoped the same way — any authenticated caller may
  // hold a valid token, so it looks the token up directly instead of going through
  // requireWhiteboardAccess.
  app.post(
    '/share-links/:token/redeem',
    {
      // The only route that takes a secret from the URL, so it is the only one where
      // guessing is even conceivable. 24 random bytes make that hopeless already; this just
      // removes the incentive to try.
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: { params: tokenParams, response: { 200: shareLinkRedeemResultSchema } },
    },
    async (request) => {
      const result = await redeemShareLink(request.server.db, request.params.token, request.user);
      if (!result) throw new AppError(404, 'NOT_FOUND', 'Invalid token');
      return result;
    },
  );
}
