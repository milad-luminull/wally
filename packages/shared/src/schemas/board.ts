import { z } from 'zod';
import { effectiveRoleSchema } from '../enums.js';
import { BOARD_NAME_MAX_LENGTH } from '../constants.js';

export const whiteboardRenameSchema = z.object({
  name: z.string().trim().min(1).max(BOARD_NAME_MAX_LENGTH),
});
export type WhiteboardRenameInput = z.infer<typeof whiteboardRenameSchema>;

/** Same rule as rename: one trimmed, non-empty name. Kept separate so the two can diverge. */
export const whiteboardCreateSchema = whiteboardRenameSchema;
export type WhiteboardCreateInput = z.infer<typeof whiteboardCreateSchema>;

export const whiteboardDtoSchema = z.object({
  revision: z.number().int().nonnegative(),
  id: z.string(),
  name: z.string(),
  ownerId: z.string(),
  currentUserRole: effectiveRoleSchema,
  /**
   * Deployment switch and, later, the per-board switch combined: what the web shows.
   * Defaults to false because board.create and board.rename store this DTO in their
   * idempotency receipt, and a replay returns it unchanged: a receipt written before this
   * field existed must still parse within its seven-day window rather than fail as a 500.
   */
  assistantEnabled: z.boolean().default(false),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type WhiteboardDto = z.infer<typeof whiteboardDtoSchema>;

export const whiteboardSummaryDtoSchema = whiteboardDtoSchema.pick({
  id: true,
  name: true,
  currentUserRole: true,
});
export type WhiteboardSummaryDto = z.infer<typeof whiteboardSummaryDtoSchema>;
