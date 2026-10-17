import type { Firestore } from 'firebase-admin/firestore';
import type { BoardCommand, NoteDetailDto, NoteDto } from '@wally/shared';
import { executeBoardCommand, type Actor, type CommandLogger } from '../commands/index.js';
import { getNote, listMembers, listNotes } from '../commands/queries.js';
import { AppError } from '../errors.js';
import {
  operationAnnotations,
  operationInputs,
  type OperationInput,
  type OperationName,
} from './operations.js';
import type { Provenance } from './provenance.js';

export interface OperationContext {
  db: Firestore;
  actor: Actor;
  /** The board the conversation is bound to; every call must name it. */
  boardId: string;
  /**
   * The effective switch: the deployment switch and the board owner's switch combined
   * (assistantEnabledFor).
   */
  assistantEnabled: boolean;
  provenance: Provenance;
  logger?: CommandLogger;
}
export interface OperationCall {
  name: string;
  input: unknown;
  /** Allocated by the caller, one per write, reused on retry so the receipt replays. */
  operationId: string;
}
export interface OperationResult {
  data: unknown;
  /**
   * The committed revision of a write, the note revision for get_note, the board revision
   * for list_members, null for list_notes.
   */
  revision: number | null;
}
/** A compact row for the model: what a question needs, not the whole note. */
export interface NoteRow {
  id: string;
  title: string;
  status: NoteDto['status'];
  priority: NoteDto['priority'];
  horizon: NoteDto['horizon'];
  dueDate: string | null;
  visibility: NoteDto['visibility'];
  assignee: NoteDto['assignee'];
  subtaskSummary: NoteDto['subtaskSummary'];
  revision: number;
}

const notFound = () => new AppError(404, 'NOT_FOUND', 'Not found');

/**
 * Runs one assistant operation for one caller on one board. Reads go to the query
 * functions; writes go through executeBoardCommand with the caller as actor, the call's
 * operation id and expected revision, and the server's provenance. Nothing here touches
 * Firestore directly.
 */
export async function runOperation(
  ctx: OperationContext,
  call: OperationCall,
): Promise<OperationResult> {
  if (!ctx.assistantEnabled) throw notFound();
  if (!Object.hasOwn(operationInputs, call.name))
    throw new AppError(400, 'BAD_REQUEST', 'Unknown operation');
  const name = call.name as OperationName;
  const parsed = operationInputs[name].safeParse(call.input);
  if (!parsed.success) throw new AppError(400, 'BAD_REQUEST', 'Invalid operation input');
  // Board context is explicit: the call names the board, and it must be the bound one.
  if (parsed.data.boardId !== ctx.boardId) throw notFound();

  if (operationAnnotations[name].readOnlyHint) return read(ctx, name, parsed.data);

  const { command, expectedRevision } = toCommand(name, parsed.data);
  const result = await executeBoardCommand(
    ctx.db,
    ctx.actor,
    command,
    { operationId: call.operationId, expectedRevision },
    { logger: ctx.logger, provenance: ctx.provenance },
  );
  return { data: result.data, revision: result.revision };
}

async function read(
  ctx: OperationContext,
  name: OperationName,
  input: OperationInput<OperationName>,
): Promise<OperationResult> {
  const { db, actor, boardId } = ctx;
  switch (name) {
    case 'list_notes': {
      const { q, status, priority, horizon, assignedToMe, limit } =
        input as OperationInput<'list_notes'>;
      const notes = await listNotes(db, actor, boardId, {
        ...(q !== undefined ? { q } : {}),
        status,
        ...(priority ? { priority: priority.join(',') } : {}),
        ...(horizon ? { horizon: horizon.join(',') } : {}),
        ...(assignedToMe ? { assignedToMe: 'true' } : {}),
      });
      return {
        data: {
          notes: notes.slice(0, limit).map(toRow),
          truncated: notes.length > limit,
          total: notes.length,
        },
        revision: null,
      };
    }
    case 'get_note': {
      const { noteId } = input as OperationInput<'get_note'>;
      const note = withoutHistory(await getNote(db, actor, noteId, boardId));
      return { data: note, revision: note.revision };
    }
    case 'list_members': {
      const members = await listMembers(db, actor, boardId);
      return { data: members.data, revision: members.revision };
    }
    default:
      throw new AppError(400, 'BAD_REQUEST', 'Unknown operation');
  }
}

/** The model reads the note itself; its change history is not part of the answer. */
function withoutHistory({
  history: _history,
  ...note
}: NoteDetailDto): Omit<NoteDetailDto, 'history'> {
  return note;
}

function toRow(note: NoteDto): NoteRow {
  return {
    id: note.id,
    title: note.title,
    status: note.status,
    priority: note.priority,
    horizon: note.horizon,
    dueDate: note.dueDate,
    visibility: note.visibility,
    assignee: note.assignee,
    subtaskSummary: note.subtaskSummary,
    revision: note.revision,
  };
}

function toCommand(
  name: OperationName,
  input: OperationInput<OperationName>,
): { command: BoardCommand; expectedRevision?: number } {
  switch (name) {
    case 'create_note': {
      const { boardId, input: body } = input as OperationInput<'create_note'>;
      return { command: { type: 'note.create', boardId, input: body } };
    }
    case 'update_note': {
      const {
        boardId,
        noteId,
        expectedRevision,
        input: body,
      } = input as OperationInput<'update_note'>;
      return { command: { type: 'note.update', noteId, boardId, input: body }, expectedRevision };
    }
    case 'move_note': {
      const {
        boardId,
        noteId,
        expectedRevision,
        input: body,
      } = input as OperationInput<'move_note'>;
      return { command: { type: 'note.move', noteId, boardId, input: body }, expectedRevision };
    }
    case 'complete_note':
    case 'reopen_note': {
      const { boardId, noteId, expectedRevision } = input as OperationInput<'complete_note'>;
      const type = name === 'complete_note' ? 'note.complete' : 'note.reopen';
      return { command: { type, noteId, boardId, input: {} }, expectedRevision };
    }
    case 'add_subtask': {
      const {
        boardId,
        noteId,
        expectedRevision,
        input: body,
      } = input as OperationInput<'add_subtask'>;
      return {
        command: { type: 'subtask.create', noteId, boardId, input: body },
        expectedRevision,
      };
    }
    case 'toggle_subtask': {
      const {
        boardId,
        noteId,
        subtaskId,
        expectedRevision,
        input: body,
      } = input as OperationInput<'toggle_subtask'>;
      return {
        command: { type: 'subtask.update', noteId, boardId, subtaskId, input: { done: body.done } },
        expectedRevision,
      };
    }
    case 'assign_note': {
      const {
        boardId,
        noteId,
        expectedRevision,
        input: body,
      } = input as OperationInput<'assign_note'>;
      return { command: { type: 'note.assign', noteId, boardId, input: body }, expectedRevision };
    }
    case 'delete_note': {
      const { boardId, noteId, expectedRevision } = input as OperationInput<'delete_note'>;
      return { command: { type: 'note.delete', noteId, boardId, input: {} }, expectedRevision };
    }
    default:
      throw new AppError(400, 'BAD_REQUEST', 'Unknown operation');
  }
}
