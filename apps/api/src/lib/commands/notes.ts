import type { BoardCommand } from '@wally/shared';
import type { NoteDoc, SubtaskDoc, WithId } from '../db/types.js';
import {
  docsWithId,
  historyCol,
  loadUsers,
  notesCol,
  now,
  stripId,
  subtasksCol,
} from '../db/collections.js';
import { toNoteDto, toSubtaskDto } from '../dto.js';
import {
  applyFieldChanges,
  applyTagChanges,
  assertPrivateAssignee,
  assertValidAssignee,
  computeMoveUpdate,
  isValidAssignee,
} from '../notes.js';
import { notFound, revisionOf, type CommandContext, type CommandResult } from './context.js';
import { AppError } from '../errors.js';

// An application bound keeps copies within one atomic transaction, with room for the
// note, history and receipt. Ordinary notes may still contain more subtasks.
const MAX_COPY_SUBTASKS = 400;

export async function executeNoteCommand(
  ctx: CommandContext,
  command: BoardCommand,
): Promise<CommandResult> {
  const { db, tx, actor, board, operationId } = ctx;
  const timestamp = now();
  const result = (
    data: unknown,
    revision: number,
    status = 200,
    cleanupId?: string,
  ): CommandResult => ({
    data,
    revision,
    status,
    boardId: board.id,
    ...(cleanupId ? { cleanupId } : {}),
  });
  const dto = async (note: WithId<NoteDoc>) =>
    toNoteDto(note, await loadUsers(db, [note.assigneeId, note.createdById]));

  if (command.type === 'note.create' || command.type === 'note.duplicate') {
    const source = ctx.note;
    const tasks =
      command.type === 'note.duplicate'
        ? docsWithId(await tx.get(subtasksCol(db, source!.id).limit(MAX_COPY_SUBTASKS + 1)))
        : [];
    if (tasks.length > MAX_COPY_SUBTASKS)
      throw new AppError(422, 'COPY_TOO_LARGE', 'A copy may contain at most 400 subtasks');
    const ref = notesCol(db).doc();
    let note: NoteDoc;
    if (command.type === 'note.create') {
      const body = command.input;
      const isPrivate = body.visibility === 'PRIVATE';
      if (isPrivate) {
        if (body.assigneeId != null) assertPrivateAssignee(actor.id, body.assigneeId);
      } else assertValidAssignee(board, body.assigneeId ?? null);
      note = {
        ...body,
        whiteboardId: board.id,
        dueDate: body.dueDate ?? null,
        assigneeId: isPrivate ? actor.id : (body.assigneeId ?? null),
        status: 'OPEN',
        completedAt: null,
        createdById: actor.id,
        subtaskSummary: { total: 0, done: 0 },
        createdAt: timestamp,
        updatedAt: timestamp,
        revision: 1,
      };
    } else {
      note = {
        ...stripId(source!),
        ...command.input,
        visibility: source!.visibility ?? 'SHARED',
        // Only the creator can reach a private source, so the copy is theirs too.
        assigneeId:
          source!.visibility === 'PRIVATE'
            ? actor.id
            : isValidAssignee(board, source!.assigneeId)
              ? source!.assigneeId
              : null,
        status: 'OPEN',
        completedAt: null,
        createdById: actor.id,
        subtaskSummary: { total: tasks.length, done: tasks.filter((t) => t.done).length },
        createdAt: timestamp,
        updatedAt: timestamp,
        revision: 1,
      };
    }
    tx.create(ref, note);
    for (const task of tasks)
      tx.create(subtasksCol(db, ref.id).doc(), {
        ...stripId(task),
        noteId: ref.id,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    tx.create(historyCol(db, ref.id).doc(), {
      noteId: ref.id,
      type: 'CREATED',
      occurredAt: timestamp,
      actorId: actor.id,
      metadata: source ? { duplicatedFrom: source.id } : null,
    });
    return result(await dto({ ...note, id: ref.id }), 1, 201);
  }

  const note = ctx.note!;
  const currentRevision = revisionOf(note);
  const revision = currentRevision + 1;
  const noteRef = notesCol(db).doc(note.id);
  if (command.type === 'note.delete') {
    const cleanupId = `${actor.id}_${operationId}`;
    tx.update(noteRef, { deletedAt: timestamp, updatedAt: timestamp, revision });
    tx.create(db.collection('boardCleanup').doc(cleanupId), {
      kind: 'note.delete',
      boardId: board.id,
      noteId: note.id,
      createdAt: timestamp,
    });
    return result(null, revision, 204, cleanupId);
  }

  if (
    command.type === 'subtask.create' ||
    command.type === 'subtask.update' ||
    command.type === 'subtask.delete'
  ) {
    const tasks = docsWithId(await tx.get(subtasksCol(db, note.id)));
    let nextTasks: WithId<SubtaskDoc>[];
    let changed: WithId<SubtaskDoc> | null;
    if (command.type === 'subtask.create') {
      const ref = subtasksCol(db, note.id).doc();
      changed = {
        id: ref.id,
        noteId: note.id,
        text: command.input.text,
        done: false,
        sortIndex: tasks.reduce((max, t) => Math.max(max, t.sortIndex + 1), 0),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      tx.create(ref, stripId(changed));
      nextTasks = [...tasks, changed];
    } else {
      const existing = tasks.find((t) => t.id === command.subtaskId && t.noteId === note.id);
      if (!existing) notFound();
      if (command.type === 'subtask.delete') {
        changed = null;
        tx.delete(subtasksCol(db, note.id).doc(existing.id));
        nextTasks = tasks.filter((t) => t.id !== existing.id);
      } else {
        const body = command.input;
        if (
          (body.text === undefined || body.text === existing.text) &&
          (body.done === undefined || body.done === existing.done)
        )
          return result(toSubtaskDto(existing), currentRevision);
        changed = { ...existing, ...body, updatedAt: timestamp };
        tx.set(subtasksCol(db, note.id).doc(existing.id), stripId(changed));
        nextTasks = tasks.map((t) => (t.id === existing.id ? changed! : t));
      }
    }
    tx.update(noteRef, {
      revision,
      updatedAt: timestamp,
      subtaskSummary: { total: nextTasks.length, done: nextTasks.filter((t) => t.done).length },
    });
    return result(
      changed ? toSubtaskDto(changed) : null,
      revision,
      command.type === 'subtask.create' ? 201 : command.type === 'subtask.delete' ? 204 : 200,
    );
  }

  let changes: Partial<NoteDoc>;
  let moveMetadata: Record<string, unknown> | undefined;
  switch (command.type) {
    case 'note.update': {
      const { fieldChanges, tagChanges, visibility, ...fields } = command.input;
      if (visibility !== undefined && note.createdById !== actor.id)
        throw new AppError(403, 'FORBIDDEN', 'Only the creator can change who sees a note');
      changes = {
        ...fields,
        ...(visibility !== undefined ? { visibility } : {}),
        // Same change set, so one revision, receipt and rollback cover both fields.
        ...(visibility === 'PRIVATE' ? { assigneeId: actor.id } : {}),
        ...(fieldChanges
          ? { customFields: applyFieldChanges(note.customFields ?? {}, fieldChanges) }
          : {}),
        ...(tagChanges ? { tags: applyTagChanges(note.tags, tagChanges) } : {}),
      };
      break;
    }
    case 'note.move': {
      const move = computeMoveUpdate(note, command.input);
      changes = move.data;
      moveMetadata = move.metadata;
      break;
    }
    case 'note.assign':
      if (note.visibility === 'PRIVATE')
        assertPrivateAssignee(note.createdById, command.input.assigneeId);
      else assertValidAssignee(board, command.input.assigneeId);
      changes = { assigneeId: command.input.assigneeId };
      break;
    case 'note.complete':
      if (note.status === 'DONE') return result(await dto(note), currentRevision);
      changes = { status: 'DONE', completedAt: timestamp };
      break;
    case 'note.reopen':
      if (note.status === 'OPEN') return result(await dto(note), currentRevision);
      changes = { status: 'OPEN', completedAt: null };
      break;
    default:
      throw new Error('Not a note command');
  }
  if (
    Object.entries(changes).every(
      ([key, value]) => JSON.stringify(note[key as keyof NoteDoc]) === JSON.stringify(value),
    )
  )
    return result(await dto(note), currentRevision);
  const updated = { ...note, ...changes, updatedAt: timestamp, revision };
  tx.update(noteRef, { ...changes, updatedAt: timestamp, revision });
  if (moveMetadata)
    tx.create(historyCol(db, note.id).doc(), {
      noteId: note.id,
      type: 'MOVED',
      occurredAt: timestamp,
      actorId: actor.id,
      metadata: moveMetadata,
    });
  return result(await dto(updated), revision);
}
