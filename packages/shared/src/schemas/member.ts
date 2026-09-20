import { z } from 'zod';
import { effectiveRoleSchema, membershipStatusSchema, whiteboardRoleSchema } from '../enums.js';

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
});
export type MemberDto = z.infer<typeof memberDtoSchema>;

export const shareLinkRoleSchema = z.object({
  role: whiteboardRoleSchema,
});
export type ShareLinkRoleInput = z.infer<typeof shareLinkRoleSchema>;

export const shareLinkDtoSchema = z.object({
  token: z.string(),
  role: whiteboardRoleSchema,
  url: z.string().url(),
});
export type ShareLinkDto = z.infer<typeof shareLinkDtoSchema>;

export const shareLinkRedeemResultSchema = z.object({
  whiteboardId: z.string(),
  role: whiteboardRoleSchema,
});
export type ShareLinkRedeemResult = z.infer<typeof shareLinkRedeemResultSchema>;
