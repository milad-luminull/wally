import type { Prisma, PrismaClient } from './prisma-client.js';
import type { NoteHorizon, NoteMoveInput, NotePriority } from '@wally/shared';
import { AppError } from './errors.js';

/** Shared `include` for a note plus everything `toNoteDto` needs. */
export const noteInclude = {
  assignee: true,
  createdBy: true,
  subtasks: true,
} as const;

/** Shared `include` for a note plus everything `toNoteDetailDto` needs. */
export const noteDetailInclude = {
  assignee: true,
  createdBy: true,
  subtasks: true,
  history: { include: { actor: true } },
} as const;

/**
 * Throws a 422 INVALID_ASSIGNEE unless `assigneeId` is null or belongs to the board
 * owner or an ACTIVE member of THIS whiteboard. Shared by note creation, PATCH /notes/:id
 * assignment fields, and POST /notes/:id/assign.
 */
export async function assertValidAssignee(
  prisma: PrismaClient,
  whiteboardId: string,
  assigneeId: string | null,
): Promise<void> {
  if (assigneeId === null) return;

  const whiteboard = await prisma.whiteboard.findUnique({
    where: { id: whiteboardId },
    select: { ownerId: true },
  });
  if (whiteboard?.ownerId === assigneeId) return;

  const member = await prisma.whiteboardMember.findFirst({
    where: { whiteboardId, userId: assigneeId, status: 'ACTIVE' },
    select: { id: true },
  });
  if (!member) {
    throw new AppError(
      422,
      'INVALID_ASSIGNEE',
      'Assignee must be the board owner or an active member of this whiteboard',
    );
  }
}

export interface MoveComputation {
  data: Pick<Prisma.NoteUpdateInput, 'horizon' | 'priority' | 'freeX' | 'freeY'>;
  metadata: Prisma.InputJsonObject;
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
export function computeMoveUpdate(existing: MovableNoteFields, input: NoteMoveInput): MoveComputation {
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
