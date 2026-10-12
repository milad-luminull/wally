import { z } from 'zod';
import { SUBTASK_TEXT_MAX_LENGTH } from '../constants.js';

export const subtaskCreateSchema = z.object({
  text: z.string().trim().min(1).max(SUBTASK_TEXT_MAX_LENGTH),
});
export type SubtaskCreateInput = z.infer<typeof subtaskCreateSchema>;

export const subtaskUpdateSchema = z
  .object({
    text: z.string().trim().min(1).max(SUBTASK_TEXT_MAX_LENGTH).optional(),
    done: z.boolean().optional(),
  })
  .strict()
  .refine((val) => val.text !== undefined || val.done !== undefined, {
    message: 'At least one of text or done must be provided',
  });
export type SubtaskUpdateInput = z.infer<typeof subtaskUpdateSchema>;

export const subtaskDtoSchema = z.object({
  id: z.string(),
  noteId: z.string(),
  text: z.string(),
  done: z.boolean(),
  sortIndex: z.number(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SubtaskDto = z.infer<typeof subtaskDtoSchema>;

export const subtaskSummarySchema = z.object({
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type SubtaskSummary = z.infer<typeof subtaskSummarySchema>;
