import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { shareLinkDtoSchema, shareLinkRedeemResultSchema, shareLinkRoleSchema } from '@wally/shared';
import { requireRole, requireWhiteboardAccess } from '../lib/authorization.js';
import { toShareLinkDto } from '../lib/dto.js';
import { AppError } from '../lib/errors.js';
import { redeemShareLink } from '../lib/members.js';
import { generateShareToken } from '../lib/tokens.js';
import { loadEnv } from '../env.js';

const whiteboardIdParams = z.object({ id: z.string() });
const tokenParams = z.object({ token: z.string() });

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
      const ctx = request.whiteboardContext!;
      const shareLink = await request.server.prisma.shareLink.findUnique({
        where: { whiteboardId: ctx.whiteboardId },
      });
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
      const existing = await request.server.prisma.shareLink.findUnique({
        where: { whiteboardId: ctx.whiteboardId },
      });
      if (existing) {
        throw new AppError(409, 'SHARE_LINK_EXISTS', 'A share link already exists for this board');
      }
      const shareLink = await request.server.prisma.shareLink.create({
        data: { whiteboardId: ctx.whiteboardId, token: generateShareToken(), role: request.body.role },
      });
      reply.code(201);
      return toShareLinkDto(shareLink, baseUrl);
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
      const ctx = request.whiteboardContext!;
      const existing = await request.server.prisma.shareLink.findUnique({
        where: { whiteboardId: ctx.whiteboardId },
      });
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'No share link');
      const shareLink = await request.server.prisma.shareLink.update({
        where: { whiteboardId: ctx.whiteboardId },
        data: { role: request.body.role },
      });
      return toShareLinkDto(shareLink, baseUrl);
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
      const existing = await request.server.prisma.shareLink.findUnique({
        where: { whiteboardId: ctx.whiteboardId },
      });
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'No share link');
      await request.server.prisma.shareLink.delete({ where: { whiteboardId: ctx.whiteboardId } });
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
      const existing = await request.server.prisma.shareLink.findUnique({
        where: { whiteboardId: ctx.whiteboardId },
      });
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'No share link');
      const shareLink = await request.server.prisma.shareLink.update({
        where: { whiteboardId: ctx.whiteboardId },
        data: { token: generateShareToken() },
      });
      return toShareLinkDto(shareLink, baseUrl);
    },
  );

  // Redemption is not whiteboard-scoped the same way — any authenticated caller may
  // hold a valid token, so it looks the token up directly instead of going through
  // requireWhiteboardAccess.
  app.post(
    '/share-links/:token/redeem',
    {
      schema: { params: tokenParams, response: { 200: shareLinkRedeemResultSchema } },
    },
    async (request) => {
      const result = await redeemShareLink(request.server.prisma, request.params.token, request.user.id);
      if (!result) throw new AppError(404, 'NOT_FOUND', 'Invalid token');
      return result;
    },
  );
}
