import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { subtaskCreateSchema, subtaskDtoSchema, subtaskUpdateSchema } from '@wally/shared';
import type { SubtaskDoc, WithId } from '../lib/db/types.js';
import { notesCol, now, subtasksCol, withId } from '../lib/db/collections.js';
import { requireRole, requireWhiteboardAccess } from '../lib/authorization.js';
import { toSubtaskDto } from '../lib/dto.js';
import { AppError } from '../lib/errors.js';

const noteIdParams = z.object({ id: z.string() });
const subtaskParams = z.object({ id: z.string(), subtaskId: z.string() });

/**
 * Every write here also moves the note's denormalized `subtaskSummary`, in the same
 * transaction, because NoteDto carries that count for each note on a board and reading
 * the real subcollection per note would be a read per card.
 *
 * The counter moves by increments rather than a recount, and deliberately does NOT touch
 * the note's own `updatedAt` — subtask edits never did under the relational schema, and
 * the frontend treats that timestamp as "when the note itself changed".
 */
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
      const db = request.server.db;
      const subtasks = subtasksCol(db, noteId);

      const subtask = await db.runTransaction(async (tx) => {
        const last = await tx.get(subtasks.orderBy('sortIndex', 'desc').limit(1));
        const sortIndex = last.empty ? 0 : last.docs[0]!.data().sortIndex + 1;

        const timestamp = now();
        const created: SubtaskDoc = {
          noteId,
          text: request.body.text,
          done: false,
          sortIndex,
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        const ref = subtasks.doc();
        tx.set(ref, created);
        tx.update(notesCol(db).doc(noteId), {
          'subtaskSummary.total': FieldValue.increment(1),
        });
        return { ...created, id: ref.id };
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
      const db = request.server.db;
      const subtasks = subtasksCol(db, noteId);
      const body = request.body;

      const subtask = await db.runTransaction(async (tx) => {
        const existing = withId(await tx.get(subtasks.doc(subtaskId)));
        if (!existing) throw new AppError(404, 'NOT_FOUND', 'Not found');

        const updatedAt = now();
        const changes: Partial<SubtaskDoc> = {
          ...(body.text !== undefined ? { text: body.text } : {}),
          ...(body.done !== undefined ? { done: body.done } : {}),
        };
        tx.update(subtasks.doc(subtaskId), { ...changes, updatedAt });

        // Only a real transition moves the counter — the schema happily accepts
        // done:true on an already-done subtask.
        if (body.done !== undefined && body.done !== existing.done) {
          tx.update(notesCol(db).doc(noteId), {
            'subtaskSummary.done': FieldValue.increment(body.done ? 1 : -1),
          });
        }

        const updated: WithId<SubtaskDoc> = { ...existing, ...changes, updatedAt };
        return updated;
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
      const db = request.server.db;
      const subtasks = subtasksCol(db, noteId);

      await db.runTransaction(async (tx) => {
        const existing = withId(await tx.get(subtasks.doc(subtaskId)));
        if (!existing) throw new AppError(404, 'NOT_FOUND', 'Not found');

        tx.delete(subtasks.doc(subtaskId));
        tx.update(notesCol(db).doc(noteId), {
          'subtaskSummary.total': FieldValue.increment(-1),
          ...(existing.done ? { 'subtaskSummary.done': FieldValue.increment(-1) } : {}),
        });
      });

      return reply.code(204).send();
    },
  );
}
