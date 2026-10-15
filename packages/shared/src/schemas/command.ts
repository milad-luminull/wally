import { z } from 'zod';
import {
  whiteboardAssistantSchema,
  whiteboardCreateSchema,
  whiteboardRenameSchema,
} from './board.js';
import { inviteCreateSchema, memberRoleUpdateSchema, shareLinkRoleSchema } from './member.js';
import {
  noteAssignSchema,
  noteCreateSchema,
  noteDuplicateSchema,
  noteMoveSchema,
  noteUpdateSchema,
} from './note.js';
import { subtaskCreateSchema, subtaskUpdateSchema } from './subtask.js';

export const revisionSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER - 1);
export const operationMetadataSchema = z
  .object({
    operationId: z.string().uuid(),
    expectedRevision: revisionSchema.optional(),
  })
  .strict();
export type OperationMetadata = z.infer<typeof operationMetadataSchema>;

const id = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => !value.includes('/') && value !== '.' && value !== '..');
const board = { boardId: id };
const note = { noteId: id, boardId: id.optional() };
const empty = z.object({}).strict().default({});
// These contracts are validated again by the application layer, not only by HTTP.
export const boardCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('note.create'), ...board, input: noteCreateSchema.strict() }).strict(),
  z.object({ type: z.literal('note.update'), ...note, input: noteUpdateSchema }).strict(),
  z.object({ type: z.literal('note.move'), ...note, input: noteMoveSchema }).strict(),
  z.object({ type: z.literal('note.assign'), ...note, input: noteAssignSchema.strict() }).strict(),
  z
    .object({ type: z.literal('note.duplicate'), ...note, input: noteDuplicateSchema.strict() })
    .strict(),
  z.object({ type: z.literal('note.complete'), ...note, input: empty }).strict(),
  z.object({ type: z.literal('note.reopen'), ...note, input: empty }).strict(),
  z.object({ type: z.literal('note.delete'), ...note, input: empty }).strict(),
  z
    .object({ type: z.literal('subtask.create'), ...note, input: subtaskCreateSchema.strict() })
    .strict(),
  z
    .object({
      type: z.literal('subtask.update'),
      ...note,
      subtaskId: id,
      input: subtaskUpdateSchema,
    })
    .strict(),
  z.object({ type: z.literal('subtask.delete'), ...note, subtaskId: id, input: empty }).strict(),
  z
    .object({ type: z.literal('board.rename'), ...board, input: whiteboardRenameSchema.strict() })
    .strict(),
  z
    .object({
      type: z.literal('board.assistant'),
      ...board,
      input: whiteboardAssistantSchema.strict(),
    })
    .strict(),
  z.object({ type: z.literal('board.create'), input: whiteboardCreateSchema.strict() }).strict(),
  z.object({ type: z.literal('board.delete'), ...board, input: empty }).strict(),
  z.object({ type: z.literal('board.leave'), ...board, input: empty }).strict(),
  z
    .object({ type: z.literal('member.invite'), ...board, input: inviteCreateSchema.strict() })
    .strict(),
  z
    .object({
      type: z.literal('member.update'),
      ...board,
      memberId: id,
      input: memberRoleUpdateSchema.strict(),
    })
    .strict(),
  z.object({ type: z.literal('member.delete'), ...board, memberId: id, input: empty }).strict(),
  z
    .object({ type: z.literal('link.create'), ...board, input: shareLinkRoleSchema.strict() })
    .strict(),
  z
    .object({ type: z.literal('link.update'), ...board, input: shareLinkRoleSchema.strict() })
    .strict(),
  z.object({ type: z.literal('link.rotate'), ...board, input: empty }).strict(),
  z.object({ type: z.literal('link.delete'), ...board, input: empty }).strict(),
  z.object({ type: z.literal('link.redeem'), token: id, input: empty }).strict(),
]);
export type BoardCommand = z.infer<typeof boardCommandSchema>;
