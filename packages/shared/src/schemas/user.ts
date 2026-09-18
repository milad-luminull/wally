import { z } from 'zod';

/** Minimal user info embedded in other DTOs (assignee, createdBy, member). */
export const userSummarySchema = z.object({
  id: z.string(),
  email: z.string().email(),
  displayName: z.string().nullable(),
});
export type UserSummary = z.infer<typeof userSummarySchema>;
