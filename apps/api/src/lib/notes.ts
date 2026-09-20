import type { NoteHorizon, NoteMoveInput, NotePriority } from '@wally/shared';
import type { NoteDoc, WhiteboardDoc, WithId } from './db/types.js';
import { AppError } from './errors.js';

/**
 * Throws a 422 INVALID_ASSIGNEE unless `assigneeId` is null or belongs to the board owner
 * or an ACTIVE member of THIS whiteboard. Shared by note creation and POST /notes/:id/assign.
 *
 * Takes the board `requireWhiteboardAccess` already loaded into
 * `request.whiteboardContext.board` rather than reading it a second time — `memberRoles`
 * holds ACTIVE members only, which is exactly the check.
 */
export function assertValidAssignee(board: WithId<WhiteboardDoc>, assigneeId: string | null): void {
  if (assigneeId === null) return;
  if (board.ownerId === assigneeId || board.memberRoles[assigneeId]) return;

  throw new AppError(
    422,
    'INVALID_ASSIGNEE',
    'Assignee must be the board owner or an active member of this whiteboard',
  );
}

export interface MoveComputation {
  data: Partial<Pick<NoteDoc, 'horizon' | 'priority' | 'freeX' | 'freeY'>>;
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
