import { z } from 'zod';
import {
  effectiveRoleSchema,
  membershipStatusSchema,
  shareLinkDurationSchema,
  whiteboardRoleSchema,
} from '../enums.js';

export const inviteCreateSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: whiteboardRoleSchema,
});
export type InviteCreateInput = z.infer<typeof inviteCreateSchema>;

export const memberRoleUpdateSchema = z.object({
  role: whiteboardRoleSchema,
});
export type MemberRoleUpdateInput = z.infer<typeof memberRoleUpdateSchema>;

export const memberDtoSchema = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  email: z.string().email(),
  displayName: z.string().nullable(),
  /**
   * Wider than the persisted `MemberDoc.role`, which is only ever VIEW|EDIT. The owner has
   * no member document at all — the members route synthesizes their row (see
   * `ownerMemberDto`), and OWNER only ever reaches a client that way.
   */
  role: effectiveRoleSchema,
  status: membershipStatusSchema,
  /** Joined through the share link; loses access when the link expires or is replaced. */
  joinedByLink: z.boolean(),
});
export type MemberDto = z.infer<typeof memberDtoSchema>;

export const shareLinkCreateSchema = z.object({
  role: whiteboardRoleSchema,
  /** Defaults to 30 days, so clients that send only a role keep working. */
  expiresIn: shareLinkDurationSchema.default('DAYS_30'),
});
export type ShareLinkCreateInput = z.input<typeof shareLinkCreateSchema>;

export const shareLinkUpdateSchema = z
  .object({
    role: whiteboardRoleSchema.optional(),
    /** Counted from the change. */
    expiresIn: shareLinkDurationSchema.optional(),
  })
  .strict()
  .refine((input) => input.role !== undefined || input.expiresIn !== undefined, {
    message: 'Change the role, the expiry, or both',
  });
export type ShareLinkUpdateInput = z.infer<typeof shareLinkUpdateSchema>;

export const shareLinkDtoSchema = z.object({
  token: z.string(),
  role: whiteboardRoleSchema,
  url: z.string().url(),
  /** ISO datetime; null when the link never expires. */
  expiresAt: z.string().datetime().nullable(),
});
export type ShareLinkDto = z.infer<typeof shareLinkDtoSchema>;

export const shareLinkRedeemResultSchema = z.object({
  whiteboardId: z.string(),
  role: whiteboardRoleSchema,
});
export type ShareLinkRedeemResult = z.infer<typeof shareLinkRedeemResultSchema>;
