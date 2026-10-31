import { asc, eq, inArray } from 'drizzle-orm';
import type { BoardCommand } from '@wally/shared';
import type { Note, NoteRow, SubtaskRow } from '../db/types.js';
import { loadUsers } from '../db/records.js';
import { newId } from '../db/ids.js';
import { boardCleanup, noteHistory, notes, subtasks } from '../postgres/schema/index.js';
import { toNoteDto, toSubtaskDto } from '../dto.js';
import {
  applyFieldChanges,
  applyLinkChanges,
  applyTagChanges,
  assertPrivateAssignee,
  assertValidAssignee,
  canSeeNote,
  computeMoveUpdate,
  isValidAssignee,
} from '../notes.js';
import { notFound, type CommandContext, type CommandResult } from './context.js';
import { AppError } from '../errors.js';

// An application bound keeps a copy's transaction small. Ordinary notes may still contain
// more subtasks.
const MAX_COPY_SUBTASKS = 400;

export async function executeNoteCommand(
  ctx: CommandContext,
  command: BoardCommand,
): Promise<CommandResult> {
  const { tx, actor, board, operationId } = ctx;
  const timestamp = new Date();
  const via = ctx.provenance ? { via: ctx.provenance.via } : {};
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
  const dto = async (note: Note) =>
    toNoteDto(note, await loadUsers(tx, [note.assigneeId, note.createdById]));
  const summaryOf = (tasks: Pick<SubtaskRow, 'done'>[]) => ({
    total: tasks.length,
    done: tasks.filter((t) => t.done).length,
  });

  if (command.type === 'note.create' || command.type === 'note.duplicate') {
    const source = ctx.note;
    const tasks =
      command.type === 'note.duplicate'
        ? await tx
            .select()
            .from(subtasks)
            .where(eq(subtasks.noteId, source!.id))
            .orderBy(asc(subtasks.sortIndex))
            .limit(MAX_COPY_SUBTASKS + 1)
        : [];
    if (tasks.length > MAX_COPY_SUBTASKS)
      throw new AppError(422, 'COPY_TOO_LARGE', 'A copy may contain at most 400 subtasks');
    const id = newId();
    let note: NoteRow;
    if (command.type === 'note.create') {
      const body = command.input;
      const isPrivate = body.visibility === 'PRIVATE';
      if (isPrivate) {
        if (body.assigneeId != null) assertPrivateAssignee(actor.id, body.assigneeId);
      } else assertValidAssignee(board, body.assigneeId ?? null);
      note = {
        ...body,
        id,
        boardId: board.id,
        deletedAt: null,
        links: [],
        dueDate: body.dueDate ?? null,
        assigneeId: isPrivate ? actor.id : (body.assigneeId ?? null),
        status: 'OPEN',
        completedAt: null,
        createdById: actor.id,
        createdAt: timestamp,
        updatedAt: timestamp,
        revision: 1,
      };
    } else {
      const { subtaskSummary: _summary, ...copied } = source!;
      note = {
        ...copied,
        ...command.input,
        id,
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
        createdAt: timestamp,
        updatedAt: timestamp,
        revision: 1,
      };
    }
    await tx.insert(notes).values(note);
    if (tasks.length > 0)
      await tx.insert(subtasks).values(
        tasks.map((task) => ({
          ...task,
          id: newId(),
          noteId: id,
          createdAt: timestamp,
          updatedAt: timestamp,
        })),
      );
    await tx.insert(noteHistory).values({
      id: newId(),
      noteId: id,
      type: 'CREATED',
      occurredAt: timestamp,
      actorId: actor.id,
      metadata:
        source || ctx.provenance
          ? { ...(source ? { duplicatedFrom: source.id } : {}), ...via }
          : null,
    });
    return result(await dto({ ...note, subtaskSummary: summaryOf(tasks) }), 1, 201);
  }

  const note = ctx.note!;
  const currentRevision = note.revision;
  const revision = currentRevision + 1;
  const bumpNote = (changes: Partial<typeof notes.$inferInsert> = {}) =>
    tx
      .update(notes)
      .set({ ...changes, updatedAt: timestamp, revision })
      .where(eq(notes.id, note.id));
  if (command.type === 'note.delete') {
    const cleanupId = `${actor.id}_${operationId}`;
    await bumpNote({ deletedAt: timestamp });
    await tx.insert(boardCleanup).values({
      id: cleanupId,
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
    const tasks = await tx.select().from(subtasks).where(eq(subtasks.noteId, note.id));
    let changed: SubtaskRow | null;
    if (command.type === 'subtask.create') {
      changed = {
        id: newId(),
        noteId: note.id,
        text: command.input.text,
        done: false,
        sortIndex: tasks.reduce((max, t) => Math.max(max, t.sortIndex + 1), 0),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await tx.insert(subtasks).values(changed);
    } else {
      const existing = tasks.find((t) => t.id === command.subtaskId);
      if (!existing) notFound();
      if (command.type === 'subtask.delete') {
        changed = null;
        await tx.delete(subtasks).where(eq(subtasks.id, existing.id));
      } else {
        const body = command.input;
        if (
          (body.text === undefined || body.text === existing.text) &&
          (body.done === undefined || body.done === existing.done)
        )
          return result(toSubtaskDto(existing), currentRevision);
        changed = { ...existing, ...body, updatedAt: timestamp };
        await tx
          .update(subtasks)
          .set({ text: changed.text, done: changed.done, updatedAt: timestamp })
          .where(eq(subtasks.id, existing.id));
      }
    }
    await bumpNote();
    return result(
      changed ? toSubtaskDto(changed) : null,
      revision,
      command.type === 'subtask.create' ? 201 : command.type === 'subtask.delete' ? 204 : 200,
    );
  }

  let changes: Partial<NoteRow>;
  let moveMetadata: Record<string, unknown> | undefined;
  switch (command.type) {
    case 'note.update': {
      const { fieldChanges, tagChanges, linkChanges, visibility, ...fields } = command.input;
      if (visibility !== undefined && note.createdById !== actor.id)
        throw new AppError(403, 'FORBIDDEN', 'Only the creator can change who sees a note');
      let links: string[] | undefined;
      if (linkChanges) {
        const current = note.links;
        const requested = [...new Set(linkChanges.add ?? [])];
        const ids = [...new Set([...current, ...requested])];
        const targets = ids.length
          ? await tx
              .select({
                id: notes.id,
                boardId: notes.boardId,
                deletedAt: notes.deletedAt,
                visibility: notes.visibility,
                createdById: notes.createdById,
              })
              .from(notes)
              .where(inArray(notes.id, ids))
          : [];
        const byId = new Map(targets.map((target) => [target.id, target]));
        // Validate every requested target, even an already stored edge: otherwise success
        // reveals an inaccessible relation and lets unrelated fields bypass refusal.
        for (const id of requested) {
          const target = byId.get(id);
          if (
            !target ||
            target.deletedAt ||
            target.boardId !== board.id ||
            !canSeeNote(target, actor.id)
          )
            throw new AppError(422, 'LINK_TARGET_INVALID', 'A link must name a note on this board');
        }
        // Reclaim dead edges on a link edit so invisible tombstones cannot exhaust capacity.
        // Live private targets remain stored; only response mapping hides them per reader.
        const live = current.filter((id) => {
          const target = byId.get(id);
          return target && !target.deletedAt && target.boardId === board.id;
        });
        const next = applyLinkChanges(live, linkChanges, note.id);
        if (JSON.stringify(next) !== JSON.stringify(current)) links = next;
      }
      changes = {
        ...fields,
        ...(visibility !== undefined ? { visibility } : {}),
        // Same change set, so one revision, receipt and rollback cover both fields.
        ...(visibility === 'PRIVATE' ? { assigneeId: actor.id } : {}),
        ...(fieldChanges
          ? { customFields: applyFieldChanges(note.customFields, fieldChanges) }
          : {}),
        ...(tagChanges ? { tags: applyTagChanges(note.tags, tagChanges) } : {}),
        ...(links ? { links } : {}),
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
      ([key, value]) => JSON.stringify(note[key as keyof NoteRow]) === JSON.stringify(value),
    )
  )
    return result(await dto(note), currentRevision);
  const updated = { ...note, ...changes, updatedAt: timestamp, revision };
  await bumpNote(changes);
  if (moveMetadata)
    await tx.insert(noteHistory).values({
      id: newId(),
      noteId: note.id,
      type: 'MOVED',
      occurredAt: timestamp,
      actorId: actor.id,
      metadata: { ...moveMetadata, ...via },
    });
  return result(await dto(updated), revision);
}
