import type { PrismaClient, WhiteboardMember } from './prisma-client.js';
import type { WhiteboardRole } from '@wally/shared';

/**
 * Creates or updates a WhiteboardMember invite. Looks up any existing row for this
 * person on this board by userId (if they already have a User record) OR invitedEmail
 * (if they were invited before signing up, or before ever authenticating against this
 * board) rather than a single upsert keyed on one unique constraint — that avoids a
 * duplicate-key error when a User record exists but the pending invite row is still
 * keyed by invitedEmail (auto-activation only links them the next time that person
 * authenticates — see activatePendingInvitesForEmail below, called from plugins/auth.ts).
 *
 * If no User exists yet for that email, creates a PENDING row; if one does, creates/
 * updates an ACTIVE row linked to it. Re-inviting an existing row just updates its role.
 */
export async function upsertInvite(
  prisma: PrismaClient,
  whiteboardId: string,
  email: string,
  role: WhiteboardRole,
): Promise<WhiteboardMember> {
  const user = await prisma.user.findUnique({ where: { email } });

  const existing = await prisma.whiteboardMember.findFirst({
    where: {
      whiteboardId,
      OR: [...(user ? [{ userId: user.id }] : []), { invitedEmail: email }],
    },
  });

  if (existing) {
    return prisma.whiteboardMember.update({
      where: { id: existing.id },
      data: user
        ? {
            role,
            status: 'ACTIVE',
            userId: user.id,
            invitedEmail: null,
            activatedAt: existing.activatedAt ?? new Date(),
          }
        : { role },
    });
  }

  return prisma.whiteboardMember.create({
    data: user
      ? { whiteboardId, userId: user.id, role, status: 'ACTIVE', activatedAt: new Date() }
      : { whiteboardId, invitedEmail: email, role, status: 'PENDING' },
  });
}

/**
 * Auto-activates every PENDING WhiteboardMember row whose invitedEmail case-insensitively
 * matches `email`, linking it to `userId`. Called from the auth preHandler on every
 * authenticated request so a person's pending invites activate the first time they sign
 * in, on whichever board(s) they were invited to. Returns the number of rows activated.
 */
export async function activatePendingInvitesForEmail(
  prisma: PrismaClient,
  userId: string,
  email: string,
): Promise<number> {
  const result = await prisma.whiteboardMember.updateMany({
    where: { invitedEmail: { equals: email, mode: 'insensitive' }, status: 'PENDING' },
    data: { userId, status: 'ACTIVE', activatedAt: new Date() },
  });
  return result.count;
}

export interface ShareLinkRedeemResult {
  whiteboardId: string;
  role: WhiteboardRole;
}

/**
 * Redeems a share-link token for `userId`. Returns null if the token doesn't exist
 * (caller should 404). The owner redeeming their own board's link is a no-op (they're
 * always OWNER regardless, never get a WhiteboardMember row). Otherwise creates or
 * upgrades the caller's membership to the link's role, but NEVER downgrades an existing
 * EDIT membership to VIEW.
 */
export async function redeemShareLink(
  prisma: PrismaClient,
  token: string,
  userId: string,
): Promise<ShareLinkRedeemResult | null> {
  const shareLink = await prisma.shareLink.findUnique({ where: { token } });
  if (!shareLink) return null;

  const whiteboard = await prisma.whiteboard.findUnique({ where: { id: shareLink.whiteboardId } });
  if (!whiteboard) return null;

  if (whiteboard.ownerId === userId) {
    return { whiteboardId: whiteboard.id, role: shareLink.role };
  }

  const existing = await prisma.whiteboardMember.findFirst({
    where: { whiteboardId: whiteboard.id, userId },
  });

  let finalRole: WhiteboardRole;
  if (existing) {
    finalRole = existing.role === 'EDIT' || shareLink.role === 'EDIT' ? 'EDIT' : 'VIEW';
    if (finalRole !== existing.role || existing.status !== 'ACTIVE') {
      await prisma.whiteboardMember.update({
        where: { id: existing.id },
        data: { role: finalRole, status: 'ACTIVE', activatedAt: existing.activatedAt ?? new Date() },
      });
    }
  } else {
    finalRole = shareLink.role;
    await prisma.whiteboardMember.create({
      data: {
        whiteboardId: whiteboard.id,
        userId,
        role: finalRole,
        status: 'ACTIVE',
        activatedAt: new Date(),
      },
    });
  }

  return { whiteboardId: whiteboard.id, role: finalRole };
}
