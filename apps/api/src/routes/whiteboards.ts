import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  memberDtoSchema,
  whiteboardDtoSchema,
  whiteboardRenameSchema,
  whiteboardSummaryDtoSchema,
} from '@wally/shared';
import { requireRole, requireWhiteboardAccess } from '../lib/authorization.js';
import { toMemberDto, toWhiteboardDto } from '../lib/dto.js';
import { AppError } from '../lib/errors.js';

const idParamsSchema = z.object({ id: z.string() });

export default async function whiteboardRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/whiteboards',
    { schema: { response: { 200: z.array(whiteboardSummaryDtoSchema) } } },
    async (request) => {
      const userId = request.user.id;
      const owned = await request.server.prisma.whiteboard.findMany({ where: { ownerId: userId } });
      const memberOf = await request.server.prisma.whiteboard.findMany({
        where: { members: { some: { userId, status: 'ACTIVE' } } },
      });

      const ownedDtos = owned.map((w) => toWhiteboardDto(w, 'OWNER'));

      // Resolve each membered board's actual role (VIEW/EDIT) individually.
      const memberBoardDtos = await Promise.all(
        memberOf.map(async (w) => {
          const membership = await request.server.prisma.whiteboardMember.findFirst({
            where: { whiteboardId: w.id, userId, status: 'ACTIVE' },
            select: { role: true },
          });
          return toWhiteboardDto(w, membership?.role ?? 'VIEW');
        }),
      );

      const all = [...ownedDtos, ...memberBoardDtos];
      return all.map((w) => ({ id: w.id, name: w.name, currentUserRole: w.currentUserRole }));
    },
  );

  app.get(
    '/whiteboards/:id',
    {
      preHandler: [
        requireWhiteboardAccess({ kind: 'whiteboardParam' }),
        requireRole(['OWNER', 'EDIT', 'VIEW']),
      ],
      schema: { params: idParamsSchema, response: { 200: whiteboardDtoSchema } },
    },
    async (request) => {
      const ctx = request.whiteboardContext!;
      const whiteboard = await request.server.prisma.whiteboard.findUnique({
        where: { id: ctx.whiteboardId },
      });
      if (!whiteboard) throw new AppError(404, 'NOT_FOUND', 'Not found');
      return toWhiteboardDto(whiteboard, ctx.role);
    },
  );

  app.patch(
    '/whiteboards/:id',
    {
      preHandler: [requireWhiteboardAccess({ kind: 'whiteboardParam' }), requireRole(['OWNER'])],
      schema: {
        params: idParamsSchema,
        body: whiteboardRenameSchema,
        response: { 200: whiteboardDtoSchema },
      },
    },
    async (request) => {
      const ctx = request.whiteboardContext!;
      const whiteboard = await request.server.prisma.whiteboard.update({
        where: { id: ctx.whiteboardId },
        data: { name: request.body.name },
      });
      return toWhiteboardDto(whiteboard, ctx.role);
    },
  );

  app.get(
    '/whiteboards/:id/members',
    {
      preHandler: [
        requireWhiteboardAccess({ kind: 'whiteboardParam' }),
        requireRole(['OWNER', 'EDIT', 'VIEW']),
      ],
      schema: { params: idParamsSchema, response: { 200: z.array(memberDtoSchema) } },
    },
    async (request) => {
      const ctx = request.whiteboardContext!;
      const members = await request.server.prisma.whiteboardMember.findMany({
        where: { whiteboardId: ctx.whiteboardId },
        include: { user: true },
        orderBy: { invitedAt: 'asc' },
      });
      return members.map(toMemberDto);
    },
  );

  app.get(
    '/whiteboards/:id/tags',
    {
      preHandler: [
        requireWhiteboardAccess({ kind: 'whiteboardParam' }),
        requireRole(['OWNER', 'EDIT', 'VIEW']),
      ],
      schema: { params: idParamsSchema, response: { 200: z.array(z.string()) } },
    },
    async (request) => {
      const ctx = request.whiteboardContext!;
      const notes = await request.server.prisma.note.findMany({
        where: { whiteboardId: ctx.whiteboardId },
        select: { tags: true },
      });
      const tagSet = new Set<string>();
      for (const note of notes) {
        for (const tag of note.tags) tagSet.add(tag);
      }
      return [...tagSet].sort((a, b) => a.localeCompare(b, 'de'));
    },
  );
}
