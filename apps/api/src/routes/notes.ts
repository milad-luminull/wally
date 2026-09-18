import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Prisma } from '../lib/prisma-client.js';
import { z } from 'zod';
import {
  noteAssignSchema,
  noteCreateSchema,
  noteDetailDtoSchema,
  noteDtoSchema,
  noteListQuerySchema,
  noteMoveSchema,
  noteUpdateSchema,
} from '@wally/shared';
import { requireRole, requireWhiteboardAccess } from '../lib/authorization.js';
import { toNoteDetailDto, toNoteDto } from '../lib/dto.js';
import { assertValidAssignee, computeMoveUpdate, noteDetailInclude, noteInclude } from '../lib/notes.js';
import { AppError } from '../lib/errors.js';

const whiteboardIdParams = z.object({ id: z.string() });
const noteIdParams = z.object({ id: z.string() });

export default async function noteRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/whiteboards/:id/notes',
    {
      preHandler: [
        requireWhiteboardAccess({ kind: 'whiteboardParam' }),
        requireRole(['OWNER', 'EDIT', 'VIEW']),
      ],
      schema: {
        params: whiteboardIdParams,
        querystring: noteListQuerySchema,
        response: { 200: z.array(noteDtoSchema) },
      },
    },
    async (request) => {
      const ctx = request.whiteboardContext!;
      const query = request.query;

      const where: Prisma.NoteWhereInput = { whiteboardId: ctx.whiteboardId };
      if (query.status !== 'ALL') where.status = query.status;
      if (query.priority?.length) where.priority = { in: query.priority };
      if (query.horizon?.length) where.horizon = { in: query.horizon };
      if (query.assignedToMe) where.assigneeId = request.user.id;

      let notes = await request.server.prisma.note.findMany({
        where,
        include: noteInclude,
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      });

      if (query.q) {
        const needle = query.q.toLowerCase();
        notes = notes.filter(
          (n) =>
            n.title.toLowerCase().includes(needle) ||
            (n.referenceLabel?.toLowerCase().includes(needle) ?? false) ||
            n.tags.some((t) => t.toLowerCase().includes(needle)),
        );
      }

      return notes.map(toNoteDto);
    },
  );

  app.post(
    '/whiteboards/:id/notes',
    {
      preHandler: [
        requireWhiteboardAccess({ kind: 'whiteboardParam' }),
        requireRole(['OWNER', 'EDIT']),
      ],
      schema: {
        params: whiteboardIdParams,
        body: noteCreateSchema,
        response: { 201: noteDtoSchema },
      },
    },
    async (request, reply) => {
      const ctx = request.whiteboardContext!;
      const body = request.body;
      const assigneeId = body.assigneeId ?? null;
      await assertValidAssignee(request.server.prisma, ctx.whiteboardId, assigneeId);

      const note = await request.server.prisma.note.create({
        data: {
          whiteboardId: ctx.whiteboardId,
          title: body.title,
          priority: body.priority,
          horizon: body.horizon,
          freeX: body.freeX,
          freeY: body.freeY,
          dueDate: body.dueDate ? new Date(body.dueDate) : null,
          assigneeId,
          referenceType: body.referenceType ?? null,
          referenceLabel: body.referenceLabel ?? null,
          tags: body.tags ?? [],
          colour: body.colour,
          createdById: request.user.id,
          history: {
            create: { type: 'CREATED', actorId: request.user.id },
          },
        },
        include: noteInclude,
      });

      reply.code(201);
      return toNoteDto(note);
    },
  );

  app.get(
    '/notes/:id',
    {
      preHandler: [
        requireWhiteboardAccess({ kind: 'noteParam' }),
        requireRole(['OWNER', 'EDIT', 'VIEW']),
      ],
      schema: { params: noteIdParams, response: { 200: noteDetailDtoSchema } },
    },
    async (request) => {
      const note = await request.server.prisma.note.findUnique({
        where: { id: request.params.id },
        include: noteDetailInclude,
      });
      if (!note) throw new AppError(404, 'NOT_FOUND', 'Not found');
      return toNoteDetailDto(note);
    },
  );

  app.patch(
    '/notes/:id',
    {
      preHandler: [requireWhiteboardAccess({ kind: 'noteParam' }), requireRole(['OWNER', 'EDIT'])],
      schema: { params: noteIdParams, body: noteUpdateSchema, response: { 200: noteDtoSchema } },
    },
    async (request) => {
      const body = request.body;
      const note = await request.server.prisma.note.update({
        where: { id: request.params.id },
        data: {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.dueDate !== undefined
            ? { dueDate: body.dueDate ? new Date(body.dueDate) : null }
            : {}),
          ...(body.referenceType !== undefined ? { referenceType: body.referenceType } : {}),
          ...(body.referenceLabel !== undefined ? { referenceLabel: body.referenceLabel } : {}),
          ...(body.tags !== undefined ? { tags: body.tags } : {}),
          ...(body.colour !== undefined ? { colour: body.colour } : {}),
        },
        include: noteInclude,
      });
      return toNoteDto(note);
    },
  );

  app.post(
    '/notes/:id/move',
    {
      preHandler: [requireWhiteboardAccess({ kind: 'noteParam' }), requireRole(['OWNER', 'EDIT'])],
      schema: { params: noteIdParams, body: noteMoveSchema, response: { 200: noteDtoSchema } },
    },
    async (request) => {
      const existing = await request.server.prisma.note.findUnique({
        where: { id: request.params.id },
      });
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'Not found');

      const { data, metadata } = computeMoveUpdate(existing, request.body);

      const note = await request.server.prisma.note.update({
        where: { id: request.params.id },
        data: {
          ...data,
          history: { create: { type: 'MOVED', actorId: request.user.id, metadata } },
        },
        include: noteInclude,
      });
      return toNoteDto(note);
    },
  );

  app.post(
    '/notes/:id/assign',
    {
      preHandler: [requireWhiteboardAccess({ kind: 'noteParam' }), requireRole(['OWNER', 'EDIT'])],
      schema: { params: noteIdParams, body: noteAssignSchema, response: { 200: noteDtoSchema } },
    },
    async (request) => {
      const ctx = request.whiteboardContext!;
      await assertValidAssignee(request.server.prisma, ctx.whiteboardId, request.body.assigneeId);
      const note = await request.server.prisma.note.update({
        where: { id: request.params.id },
        data: { assigneeId: request.body.assigneeId },
        include: noteInclude,
      });
      return toNoteDto(note);
    },
  );

  app.post(
    '/notes/:id/complete',
    {
      preHandler: [requireWhiteboardAccess({ kind: 'noteParam' }), requireRole(['OWNER', 'EDIT'])],
      schema: { params: noteIdParams, response: { 200: noteDtoSchema } },
    },
    async (request) => {
      const note = await request.server.prisma.note.update({
        where: { id: request.params.id },
        data: { status: 'DONE', completedAt: new Date() },
        include: noteInclude,
      });
      return toNoteDto(note);
    },
  );

  app.post(
    '/notes/:id/reopen',
    {
      preHandler: [requireWhiteboardAccess({ kind: 'noteParam' }), requireRole(['OWNER', 'EDIT'])],
      schema: { params: noteIdParams, response: { 200: noteDtoSchema } },
    },
    async (request) => {
      const note = await request.server.prisma.note.update({
        where: { id: request.params.id },
        data: { status: 'OPEN', completedAt: null },
        include: noteInclude,
      });
      return toNoteDto(note);
    },
  );

  app.delete(
    '/notes/:id',
    {
      preHandler: [requireWhiteboardAccess({ kind: 'noteParam' }), requireRole(['OWNER', 'EDIT'])],
      schema: { params: noteIdParams },
    },
    async (request, reply) => {
      await request.server.prisma.note.delete({ where: { id: request.params.id } });
      return reply.code(204).send();
    },
  );
}
