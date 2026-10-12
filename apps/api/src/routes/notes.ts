import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import {
  noteAssignSchema,
  noteCreateSchema,
  noteDetailDtoSchema,
  noteDtoSchema,
  noteDuplicateSchema,
  noteListQuerySchema,
  noteMoveSchema,
  noteUpdateSchema,
  normalizeFieldKey,
} from '@wally/shared';
import type { NoteDoc, WithId } from '../lib/db/types.js';
import {
  docsWithId,
  historyCol,
  loadUsers,
  notesCol,
  now,
  subtasksCol,
} from '../lib/db/collections.js';
import { requireRole, requireWhiteboardAccess } from '../lib/authorization.js';
import { toNoteDetailDto, toNoteDto } from '../lib/dto.js';
import { assertValidAssignee, computeMoveUpdate, isValidAssignee } from '../lib/notes.js';

const whiteboardIdParams = z.object({ id: z.string() });
const noteIdParams = z.object({ id: z.string() });

/**
 * Due date first, then creation order — with undated notes LAST.
 *
 * This ordering is applied in memory rather than by Firestore, deliberately. Firestore
 * sorts null before everything else (the opposite of Postgres's NULLS LAST default) and,
 * worse, omits documents missing the orderBy field entirely — an undated note would
 * silently vanish from the board instead of merely sorting early.
 */
function byDueDateThenCreated(a: WithId<NoteDoc>, b: WithId<NoteDoc>): number {
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  return a.createdAt.toMillis() - b.createdAt.toMillis();
}

/** The assignee and creator a single note's DTO needs. */
function usersForNote(db: Firestore, note: WithId<NoteDoc>) {
  return loadUsers(db, [note.assigneeId, note.createdById]);
}

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
      const db = request.server.db;

      // The board's notes are read whole and narrowed here: every filter below is
      // optional and independent, so pushing them into Firestore would mean a composite
      // index per combination for no gain at a single board's scale.
      let notes = docsWithId(
        await notesCol(db).where('whiteboardId', '==', ctx.whiteboardId).get(),
      );

      if (query.status !== 'ALL') notes = notes.filter((n) => n.status === query.status);
      if (query.priority?.length) {
        notes = notes.filter((n) => query.priority!.includes(n.priority));
      }
      if (query.horizon?.length) {
        notes = notes.filter((n) => query.horizon!.includes(n.horizon));
      }
      if (query.assignedToMe) notes = notes.filter((n) => n.assigneeId === request.user.id);

      if (query.q) {
        const needle = query.q.toLowerCase();
        notes = notes.filter(
          (n) =>
            n.title.toLowerCase().includes(needle) ||
            (n.description ?? '').toLowerCase().includes(needle) ||
            n.tags.some((t) => t.toLowerCase().includes(needle)) ||
            Object.entries(n.customFields ?? {}).some(
              ([key, value]) =>
                key.toLowerCase().includes(needle) || value.toLowerCase().includes(needle),
            ),
        );
      }

      // `field` is "Kunde" (has the property) or "Kunde:Müller GmbH" (equals that value).
      // Split on the first colon only, so a value may itself contain one.
      if (query.field) {
        const separator = query.field.indexOf(':');
        const rawKey = separator === -1 ? query.field : query.field.slice(0, separator);
        const rawValue = separator === -1 ? undefined : query.field.slice(separator + 1);
        const wantedKey = normalizeFieldKey(rawKey).toLocaleLowerCase('de');
        const wantedValue = rawValue?.trim().toLocaleLowerCase('de');

        notes = notes.filter((n) =>
          Object.entries(n.customFields ?? {}).some(
            ([key, value]) =>
              normalizeFieldKey(key).toLocaleLowerCase('de') === wantedKey &&
              (wantedValue === undefined || value.toLocaleLowerCase('de') === wantedValue),
          ),
        );
      }

      notes.sort(byDueDateThenCreated);

      const users = await loadUsers(
        db,
        notes.flatMap((n) => [n.assigneeId, n.createdById]),
      );
      return notes.map((note) => toNoteDto(note, users));
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
      const db = request.server.db;
      const assigneeId = body.assigneeId ?? null;
      assertValidAssignee(ctx.board, assigneeId);

      const ref = notesCol(db).doc();
      const timestamp = now();
      const note: NoteDoc = {
        whiteboardId: ctx.whiteboardId,
        title: body.title,
        description: body.description,
        status: 'OPEN',
        completedAt: null,
        priority: body.priority,
        horizon: body.horizon,
        freeX: body.freeX,
        freeY: body.freeY,
        dueDate: body.dueDate ?? null,
        assigneeId,
        tags: body.tags ?? [],
        customFields: body.customFields ?? {},
        colour: body.colour,
        createdById: request.user.id,
        subtaskSummary: { total: 0, done: 0 },
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      const batch = db.batch();
      batch.set(ref, note);
      batch.set(historyCol(db, ref.id).doc(), {
        noteId: ref.id,
        type: 'CREATED',
        occurredAt: timestamp,
        actorId: request.user.id,
        metadata: null,
      });
      await batch.commit();

      const created = { ...note, id: ref.id };
      reply.code(201);
      return toNoteDto(created, await usersForNote(db, created));
    },
  );

  /**
   * Copies a note whole — fields, subtasks with their ticks, tags, custom fields, assignee —
   * in one batch, so a copy is never seen half-written. The copy always starts OPEN: a
   * duplicated done note is almost always being reused, and a done copy would vanish into
   * the done styling the moment it appeared.
   */
  app.post(
    '/notes/:id/duplicate',
    {
      preHandler: [requireWhiteboardAccess({ kind: 'noteParam' }), requireRole(['OWNER', 'EDIT'])],
      schema: {
        params: noteIdParams,
        body: noteDuplicateSchema,
        response: { 201: noteDtoSchema },
      },
    },
    async (request, reply) => {
      const ctx = request.whiteboardContext!;
      const source = request.noteContext!;
      const body = request.body;
      const db = request.server.db;

      const subtasks = docsWithId(await subtasksCol(db, source.id).get());
      // The assignee may have left the board since the source was assigned; the copy then
      // starts unassigned rather than failing the whole duplicate.
      const assigneeId = isValidAssignee(ctx.board, source.assigneeId) ? source.assigneeId : null;

      const ref = notesCol(db).doc();
      const timestamp = now();
      const note: NoteDoc = {
        whiteboardId: source.whiteboardId,
        title: body.title ?? source.title,
        description: body.description ?? source.description ?? '',
        status: 'OPEN',
        completedAt: null,
        priority: body.priority ?? source.priority,
        horizon: body.horizon ?? source.horizon,
        freeX: body.freeX ?? source.freeX,
        freeY: body.freeY ?? source.freeY,
        dueDate: source.dueDate,
        assigneeId,
        tags: [...source.tags],
        customFields: { ...(source.customFields ?? {}) },
        colour: source.colour,
        createdById: request.user.id,
        subtaskSummary: {
          total: subtasks.length,
          done: subtasks.filter((s) => s.done).length,
        },
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      const batch = db.batch();
      batch.set(ref, note);
      for (const subtask of subtasks) {
        batch.set(subtasksCol(db, ref.id).doc(), {
          noteId: ref.id,
          text: subtask.text,
          done: subtask.done,
          sortIndex: subtask.sortIndex,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
      batch.set(historyCol(db, ref.id).doc(), {
        noteId: ref.id,
        type: 'CREATED',
        occurredAt: timestamp,
        actorId: request.user.id,
        metadata: { duplicatedFrom: source.id },
      });
      await batch.commit();

      const created = { ...note, id: ref.id };
      reply.code(201);
      return toNoteDto(created, await usersForNote(db, created));
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
      const note = request.noteContext!;
      const db = request.server.db;

      const [subtaskSnapshot, historySnapshot] = await Promise.all([
        subtasksCol(db, note.id).get(),
        historyCol(db, note.id).get(),
      ]);
      const subtasks = docsWithId(subtaskSnapshot);
      const history = docsWithId(historySnapshot);

      const users = await loadUsers(db, [
        note.assigneeId,
        note.createdById,
        ...history.map((event) => event.actorId),
      ]);
      return toNoteDetailDto(note, subtasks, history, users);
    },
  );

  app.patch(
    '/notes/:id',
    {
      preHandler: [requireWhiteboardAccess({ kind: 'noteParam' }), requireRole(['OWNER', 'EDIT'])],
      schema: { params: noteIdParams, body: noteUpdateSchema, response: { 200: noteDtoSchema } },
    },
    async (request) => {
      const note = request.noteContext!;
      const body = request.body;
      const db = request.server.db;

      const changes: Partial<NoteDoc> = {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.dueDate !== undefined ? { dueDate: body.dueDate } : {}),
        ...(body.customFields !== undefined ? { customFields: body.customFields } : {}),
        ...(body.tags !== undefined ? { tags: body.tags } : {}),
        ...(body.colour !== undefined ? { colour: body.colour } : {}),
      };
      const updatedAt = now();
      await notesCol(db)
        .doc(note.id)
        .update({ ...changes, updatedAt });

      const updated = { ...note, ...changes, updatedAt };
      return toNoteDto(updated, await usersForNote(db, updated));
    },
  );

  app.post(
    '/notes/:id/move',
    {
      preHandler: [requireWhiteboardAccess({ kind: 'noteParam' }), requireRole(['OWNER', 'EDIT'])],
      schema: { params: noteIdParams, body: noteMoveSchema, response: { 200: noteDtoSchema } },
    },
    async (request) => {
      const note = request.noteContext!;
      const db = request.server.db;
      const { data, metadata } = computeMoveUpdate(note, request.body);
      const timestamp = now();

      const batch = db.batch();
      batch.update(notesCol(db).doc(note.id), { ...data, updatedAt: timestamp });
      batch.set(historyCol(db, note.id).doc(), {
        noteId: note.id,
        type: 'MOVED',
        occurredAt: timestamp,
        actorId: request.user.id,
        metadata,
      });
      await batch.commit();

      const updated = { ...note, ...data, updatedAt: timestamp };
      return toNoteDto(updated, await usersForNote(db, updated));
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
      const note = request.noteContext!;
      const db = request.server.db;
      const assigneeId = request.body.assigneeId;
      assertValidAssignee(ctx.board, assigneeId);

      const updatedAt = now();
      await notesCol(db).doc(note.id).update({ assigneeId, updatedAt });

      const updated = { ...note, assigneeId, updatedAt };
      return toNoteDto(updated, await usersForNote(db, updated));
    },
  );

  app.post(
    '/notes/:id/complete',
    {
      preHandler: [requireWhiteboardAccess({ kind: 'noteParam' }), requireRole(['OWNER', 'EDIT'])],
      schema: { params: noteIdParams, response: { 200: noteDtoSchema } },
    },
    async (request) => {
      const note = request.noteContext!;
      const db = request.server.db;
      const timestamp = now();
      await notesCol(db)
        .doc(note.id)
        .update({ status: 'DONE', completedAt: timestamp, updatedAt: timestamp });

      const updated: WithId<NoteDoc> = {
        ...note,
        status: 'DONE',
        completedAt: timestamp,
        updatedAt: timestamp,
      };
      return toNoteDto(updated, await usersForNote(db, updated));
    },
  );

  app.post(
    '/notes/:id/reopen',
    {
      preHandler: [requireWhiteboardAccess({ kind: 'noteParam' }), requireRole(['OWNER', 'EDIT'])],
      schema: { params: noteIdParams, response: { 200: noteDtoSchema } },
    },
    async (request) => {
      const note = request.noteContext!;
      const db = request.server.db;
      const updatedAt = now();
      await notesCol(db).doc(note.id).update({ status: 'OPEN', completedAt: null, updatedAt });

      const updated: WithId<NoteDoc> = {
        ...note,
        status: 'OPEN',
        completedAt: null,
        updatedAt,
      };
      return toNoteDto(updated, await usersForNote(db, updated));
    },
  );

  app.delete(
    '/notes/:id',
    {
      preHandler: [requireWhiteboardAccess({ kind: 'noteParam' }), requireRole(['OWNER', 'EDIT'])],
      schema: { params: noteIdParams },
    },
    async (request, reply) => {
      const db = request.server.db;
      // Takes the subtasks and history subcollections with it — the cascade that the
      // foreign keys used to provide.
      await db.recursiveDelete(notesCol(db).doc(request.noteContext!.id));
      return reply.code(204).send();
    },
  );
}
