import { z } from 'zod';
import {
  noteAssignSchema,
  noteCreateSchema,
  noteHorizonSchema,
  noteMoveSchema,
  notePrioritySchema,
  noteUpdateSchema,
  revisionSchema,
  subtaskCreateSchema,
  type NoteVisibility,
} from '@wally/shared';

/**
 * The whole v1 operation surface of the assistant (WALLY_AGENT.md §3.3). Each operation is
 * a thin adapter over one query or one command of the board operations contract; adding
 * one is a product decision. The annotations are MCP's behaviour hints, carried here so
 * the MCP proposal needs no second definition.
 */

/** Rows a single `list_notes` call may return; it reports `truncated` beyond that. */
export const LIST_NOTES_MAX = 100;

const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[^/]+$/);
const boardRef = { boardId: id };
const noteRef = { boardId: id, noteId: id, expectedRevision: revisionSchema };

export const operationInputs = {
  list_notes: z
    .object({
      ...boardRef,
      q: z.string().trim().max(200).optional(),
      status: z.enum(['OPEN', 'DONE', 'ALL']).default('ALL'),
      priority: z.array(notePrioritySchema).optional(),
      horizon: z.array(noteHorizonSchema).optional(),
      assignedToMe: z.boolean().optional(),
      limit: z.number().int().min(1).max(LIST_NOTES_MAX).default(LIST_NOTES_MAX),
    })
    .strict(),
  get_note: z.object({ ...boardRef, noteId: id }).strict(),
  list_members: z.object(boardRef).strict(),
  create_note: z.object({ ...boardRef, input: noteCreateSchema.strict() }).strict(),
  // noteUpdateSchema has no assignment field by design; assign_note is the only way.
  update_note: z.object({ ...noteRef, input: noteUpdateSchema }).strict(),
  move_note: z.object({ ...noteRef, input: noteMoveSchema }).strict(),
  complete_note: z.object(noteRef).strict(),
  reopen_note: z.object(noteRef).strict(),
  add_subtask: z.object({ ...noteRef, input: subtaskCreateSchema.strict() }).strict(),
  toggle_subtask: z
    .object({ ...noteRef, subtaskId: id, input: z.object({ done: z.boolean() }).strict() })
    .strict(),
  assign_note: z.object({ ...noteRef, input: noteAssignSchema.strict() }).strict(),
  delete_note: z.object(noteRef).strict(),
} as const;

export type OperationName = keyof typeof operationInputs;
export type OperationInput<N extends OperationName> = z.infer<(typeof operationInputs)[N]>;
export const operationNames = Object.keys(operationInputs) as OperationName[];

/** MCP tool annotations: https://modelcontextprotocol.io/specification/2025-06-18/server/tools */
export interface OperationAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
}
const read: OperationAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
};
const write = (idempotentHint: boolean): OperationAnnotations => ({
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint,
});

export const operationAnnotations: Record<OperationName, OperationAnnotations> = {
  list_notes: read,
  get_note: read,
  list_members: read,
  create_note: write(false),
  update_note: write(true),
  move_note: write(true),
  complete_note: write(true),
  reopen_note: write(true),
  add_subtask: write(false),
  toggle_subtask: write(false),
  assign_note: write(false),
  delete_note: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
};

/** The risky cases that need a second, named confirm (WALLY_AGENT.md §3.2). */
export type OperationRisk = 'DELETE' | 'ASSIGN_OTHER' | 'MAKE_SHARED';

type RawOperationInput<N extends OperationName> = z.input<(typeof operationInputs)[N]>;

/**
 * Takes the input before or after parsing: the fields it reads (`assigneeId`, `visibility`)
 * have no defaults or transforms, so the answer is the same either way.
 */
export function riskOf<N extends OperationName>(
  name: N,
  input: RawOperationInput<N>,
  actorId: string,
  target: Pick<{ visibility: NoteVisibility }, 'visibility'> | null,
): OperationRisk | null {
  if (name === 'delete_note') return 'DELETE';
  if (name === 'create_note' || name === 'assign_note') {
    const assigneeId = (input as RawOperationInput<'create_note' | 'assign_note'>).input.assigneeId;
    if (assigneeId && assigneeId !== actorId) return 'ASSIGN_OTHER';
  }
  if (name === 'update_note') {
    const visibility = (input as RawOperationInput<'update_note'>).input.visibility;
    if (visibility === 'SHARED' && target?.visibility === 'PRIVATE') return 'MAKE_SHARED';
  }
  return null;
}
