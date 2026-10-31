import {
  findFieldKey,
  MAX_FIELDS_PER_NOTE,
  MAX_LINKS_PER_NOTE,
  MAX_TAGS_PER_NOTE,
  type CustomFields,
  type NoteHorizon,
  type NoteMoveInput,
  type NotePriority,
  type NoteUpdateInput,
} from '@wally/shared';
import type { Board, NoteRow } from './db/types.js';
import { AppError } from './errors.js';

/**
 * Throws a 422 INVALID_ASSIGNEE unless `assigneeId` is null or belongs to the board owner
 * or an ACTIVE member of THIS whiteboard. Shared by note creation and POST /notes/:id/assign.
 *
 * Takes the board `requireWhiteboardAccess` already loaded into
 * `request.whiteboardContext.board` rather than reading it a second time — `memberRoles`
 * holds ACTIVE members only, which is exactly the check.
 */
export function assertValidAssignee(board: Board, assigneeId: string | null): void {
  if (isValidAssignee(board, assigneeId)) return;

  throw new AppError(
    422,
    'INVALID_ASSIGNEE',
    'Assignee must be the board owner or an active member of this whiteboard',
  );
}

/** The rule behind `assertValidAssignee`, for callers that fall back instead of failing. */
export function isValidAssignee(board: Board, assigneeId: string | null): boolean {
  return (
    assigneeId === null ||
    board.ownerId === assigneeId ||
    (Object.hasOwn(board.memberRoles, assigneeId) &&
      (board.memberRoles[assigneeId] === 'EDIT' || board.memberRoles[assigneeId] === 'VIEW'))
  );
}

/** A private note exists only for its creator: everyone else gets "not found". */
export function canSeeNote(
  note: Pick<NoteRow, 'visibility' | 'createdById'>,
  actorId: string,
): boolean {
  return note.visibility !== 'PRIVATE' || note.createdById === actorId;
}

/** A private note is always assigned to its creator: never to someone else, never to nobody. */
export function assertPrivateAssignee(creatorId: string | null, assigneeId: string | null): void {
  if (creatorId !== null && assigneeId === creatorId) return;
  throw new AppError(
    422,
    'PRIVATE_NOTE_NOT_ASSIGNABLE',
    'A private note is always assigned to its creator',
  );
}

export interface MoveComputation {
  data: Partial<Pick<NoteRow, 'horizon' | 'priority' | 'freeX' | 'freeY'>>;
  metadata: Record<string, unknown>;
}

interface MovableNoteFields {
  horizon: NoteHorizon;
  priority: NotePriority;
  freeX: number;
  freeY: number;
}

/**
 * Pure function computing what a /notes/:id/move request should write. Each mode
 * (HORIZON/PRIORITY/FREE) touches ONLY its own field(s) — horizon, priority, and the
 * free-canvas position are three independent fields, never derived from one another.
 * This is the explicit regression point against the mockup's derive-from-position
 * shortcut (see the plan's "three independent fields" data-model decision).
 */
export function computeMoveUpdate(
  existing: MovableNoteFields,
  input: NoteMoveInput,
): MoveComputation {
  if (input.mode === 'HORIZON') {
    return {
      data: { horizon: input.horizon },
      metadata: { mode: 'HORIZON', from: existing.horizon, to: input.horizon },
    };
  }
  if (input.mode === 'PRIORITY') {
    return {
      data: { priority: input.priority },
      metadata: { mode: 'PRIORITY', from: existing.priority, to: input.priority },
    };
  }
  return {
    data: { freeX: input.x, freeY: input.y },
    metadata: {
      mode: 'FREE',
      from: { x: existing.freeX, y: existing.freeY },
      to: { x: input.x, y: input.y },
    },
  };
}

/**
 * Applies PATCH `fieldChanges` to the note's CURRENT properties — the map read inside the
 * route's transaction, not whatever the client last saw. Keys resolve case-insensitively, so
 * setting "customer" overwrites an existing "Customer" and removing "CUSTOMER" removes it.
 * Throws a 400 when the result would carry more properties than a note may hold.
 */
export function applyFieldChanges(
  current: CustomFields,
  changes: NonNullable<NoteUpdateInput['fieldChanges']>,
): CustomFields {
  const next = { ...current };
  for (const key of changes.remove ?? []) {
    const existing = findFieldKey(next, key);
    if (existing !== undefined) delete next[existing];
  }
  for (const [key, value] of Object.entries(changes.set ?? {})) {
    next[findFieldKey(next, key) ?? key] = value;
  }
  if (Object.keys(next).length > MAX_FIELDS_PER_NOTE) {
    throw new AppError(
      400,
      'BAD_REQUEST',
      `A note may carry at most ${MAX_FIELDS_PER_NOTE} properties`,
    );
  }
  return next;
}

/** The same for `tagChanges`: removals, then additions not already present, in order. */
export function applyTagChanges(
  current: string[],
  changes: NonNullable<NoteUpdateInput['tagChanges']>,
): string[] {
  const removed = new Set(changes.remove ?? []);
  const next = current.filter((tag) => !removed.has(tag));
  for (const tag of changes.add ?? []) {
    if (!next.includes(tag)) next.push(tag);
  }
  if (next.length > MAX_TAGS_PER_NOTE) {
    throw new AppError(400, 'BAD_REQUEST', `A note may carry at most ${MAX_TAGS_PER_NOTE} tags`);
  }
  return next;
}

/**
 * The same for `linkChanges`: removals, then additions not already present, in order, never
 * the note itself. Whether an added id is a live, visible note of the board is checked in the
 * command's transaction, where the notes can be read.
 */
export function applyLinkChanges(
  current: string[],
  changes: NonNullable<NoteUpdateInput['linkChanges']>,
  noteId: string,
): string[] {
  const removed = new Set(changes.remove ?? []);
  const next = current.filter((id) => !removed.has(id));
  for (const id of changes.add ?? []) {
    if (id === noteId)
      throw new AppError(422, 'LINK_TARGET_INVALID', 'A note cannot link to itself');
    if (!next.includes(id)) next.push(id);
  }
  if (next.length > MAX_LINKS_PER_NOTE)
    throw new AppError(
      400,
      'BAD_REQUEST',
      `A note may link to at most ${MAX_LINKS_PER_NOTE} notes`,
    );
  return next;
}
