import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { subtaskCreateSchema, subtaskDtoSchema, subtaskUpdateSchema } from '@wally/shared';
import { requireRole, requireWhiteboardAccess } from '../lib/authorization.js';
import { toSubtaskDto } from '../lib/dto.js';
import { AppError } from '../lib/errors.js';

const noteIdParams = z.object({ id: z.string() });
const subtaskParams = z.object({ id: z.string(), subtaskId: z.string() });

export default async function subtaskRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    '/notes/:id/subtasks',
    {
      preHandler: [requireWhiteboardAccess({ kind: 'noteParam' }), requireRole(['OWNER', 'EDIT'])],
      schema: { params: noteIdParams, body: subtaskCreateSchema, response: { 201: subtaskDtoSchema } },
    },
    async (request, reply) => {
      const noteId = request.params.id;
      const last = await request.server.prisma.subtask.findFirst({
        where: { noteId },
        orderBy: { sortIndex: 'desc' },
        select: { sortIndex: true },
      });
      const subtask = await request.server.prisma.subtask.create({
        data: {
          noteId,
          text: request.body.text,
          sortIndex: last ? last.sortIndex + 1 : 0,
        },
      });
      reply.code(201);
      return toSubtaskDto(subtask);
    },
  );

  app.patch(
    '/notes/:id/subtasks/:subtaskId',
    {
      preHandler: [requireWhiteboardAccess({ kind: 'noteParam' }), requireRole(['OWNER', 'EDIT'])],
      schema: {
        params: subtaskParams,
        body: subtaskUpdateSchema,
        response: { 200: subtaskDtoSchema },
      },
    },
    async (request) => {
      const { id: noteId, subtaskId } = request.params;
      const existing = await request.server.prisma.subtask.findUnique({ where: { id: subtaskId } });
      if (!existing || existing.noteId !== noteId) {
        throw new AppError(404, 'NOT_FOUND', 'Not found');
      }
      const body = request.body;
      const subtask = await request.server.prisma.subtask.update({
        where: { id: subtaskId },
        data: {
          ...(body.text !== undefined ? { text: body.text } : {}),
          ...(body.done !== undefined ? { done: body.done } : {}),
        },
      });
      return toSubtaskDto(subtask);
    },
  );

  app.delete(
    '/notes/:id/subtasks/:subtaskId',
    {
      preHandler: [requireWhiteboardAccess({ kind: 'noteParam' }), requireRole(['OWNER', 'EDIT'])],
      schema: { params: subtaskParams },
    },
    async (request, reply) => {
      const { id: noteId, subtaskId } = request.params;
      const existing = await request.server.prisma.subtask.findUnique({ where: { id: subtaskId } });
      if (!existing || existing.noteId !== noteId) {
        throw new AppError(404, 'NOT_FOUND', 'Not found');
      }
      await request.server.prisma.subtask.delete({ where: { id: subtaskId } });
      return reply.code(204).send();
    },
  );
}
