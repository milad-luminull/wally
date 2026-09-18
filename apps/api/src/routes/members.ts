import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { inviteCreateSchema, memberDtoSchema, memberRoleUpdateSchema } from '@wally/shared';
import { requireRole, requireWhiteboardAccess } from '../lib/authorization.js';
import { toMemberDto } from '../lib/dto.js';
import { upsertInvite } from '../lib/members.js';
import { AppError } from '../lib/errors.js';

const whiteboardIdParams = z.object({ id: z.string() });
const memberParams = z.object({ id: z.string(), memberId: z.string() });

export default async function memberRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    '/whiteboards/:id/members/invite',
    {
      preHandler: [requireWhiteboardAccess({ kind: 'whiteboardParam' }), requireRole(['OWNER'])],
      schema: {
        params: whiteboardIdParams,
        body: inviteCreateSchema,
        response: { 200: memberDtoSchema },
      },
    },
    async (request) => {
      const ctx = request.whiteboardContext!;
      const prisma = request.server.prisma;
      const email = request.body.email; // already trimmed + lowercased by the shared schema
      const role = request.body.role;

      const member = await upsertInvite(prisma, ctx.whiteboardId, email, role);

      const withUser = await prisma.whiteboardMember.findUniqueOrThrow({
        where: { id: member.id },
        include: { user: true },
      });
      return toMemberDto(withUser);
    },
  );

  app.patch(
    '/whiteboards/:id/members/:memberId',
    {
      preHandler: [requireWhiteboardAccess({ kind: 'whiteboardParam' }), requireRole(['OWNER'])],
      schema: {
        params: memberParams,
        body: memberRoleUpdateSchema,
        response: { 200: memberDtoSchema },
      },
    },
    async (request) => {
      const ctx = request.whiteboardContext!;
      const prisma = request.server.prisma;
      const existing = await prisma.whiteboardMember.findUnique({
        where: { id: request.params.memberId },
      });
      if (!existing || existing.whiteboardId !== ctx.whiteboardId) {
        throw new AppError(404, 'NOT_FOUND', 'Not found');
      }
      const member = await prisma.whiteboardMember.update({
        where: { id: request.params.memberId },
        data: { role: request.body.role },
        include: { user: true },
      });
      return toMemberDto(member);
    },
  );

  app.delete(
    '/whiteboards/:id/members/:memberId',
    {
      preHandler: [requireWhiteboardAccess({ kind: 'whiteboardParam' }), requireRole(['OWNER'])],
      schema: { params: memberParams },
    },
    async (request, reply) => {
      const ctx = request.whiteboardContext!;
      const prisma = request.server.prisma;
      const existing = await prisma.whiteboardMember.findUnique({
        where: { id: request.params.memberId },
      });
      if (!existing || existing.whiteboardId !== ctx.whiteboardId) {
        throw new AppError(404, 'NOT_FOUND', 'Not found');
      }

      await prisma.whiteboardMember.delete({ where: { id: request.params.memberId } });

      if (existing.userId) {
        await prisma.note.updateMany({
          where: { whiteboardId: ctx.whiteboardId, assigneeId: existing.userId },
          data: { assigneeId: null },
        });
      }

      return reply.code(204).send();
    },
  );
}
