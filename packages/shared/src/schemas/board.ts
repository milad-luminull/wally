import { z } from 'zod';
import { effectiveRoleSchema } from '../enums.js';
import { BOARD_NAME_MAX_LENGTH } from '../constants.js';

export const whiteboardRenameSchema = z.object({
  name: z.string().trim().min(1).max(BOARD_NAME_MAX_LENGTH),
});
export type WhiteboardRenameInput = z.infer<typeof whiteboardRenameSchema>;

export const whiteboardDtoSchema = z.object({
  revision: z.number().int().nonnegative(),
  id: z.string(),
  name: z.string(),
  ownerId: z.string(),
  currentUserRole: effectiveRoleSchema,
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
