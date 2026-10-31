import { and, eq, inArray } from 'drizzle-orm';
import type { WhiteboardRole } from '@wally/shared';
import type { Database } from './postgres/client.js';
import { withTransaction } from './postgres/transaction.js';
import { boardMembers, users, whiteboards } from './postgres/schema/index.js';
import { liveBoard, normalizeEmail } from './db/records.js';

/** EDIT outranks VIEW. The one place the "strongest role wins" rule is spelled out. */
export function strongestRole(roles: WhiteboardRole[]): WhiteboardRole | null {
  if (roles.length === 0) return null;
  return roles.includes('EDIT') ? 'EDIT' : 'VIEW';
}

/**
 * Auto-links every PENDING membership addressed to `email` to `userId`. Called from the
 * auth preHandler at the two moments a pending invite can become claimable — when the user
 * record is created, and when Firebase confirms the address (see plugins/auth.ts). Returns
 * the number of memberships activated.
 *
 * If the user ALREADY has a row on that board — they redeemed a share link before their
 * invite activated — the invite is merged into that row rather than activated alongside it.
 * Two ACTIVE rows for one person on one board list the board twice with conflicting roles,
 * and removing either row revokes access the other still grants. The invite's role wins the
 * merge, because an owner's explicit per-person grant outranks a bearer-token link
 * (redeemShareLink deliberately uses the opposite rule).
 *
 * One transaction per pending row, so a board deleted in the meantime fails only its own
 * activation, on a code path that runs inside the auth hook.
 */
export async function activatePendingInvitesForEmail(
  db: Database,
  userId: string,
  email: string,
): Promise<number> {
  const invitedEmail = normalizeEmail(email);
  const pending = await db
    .select({ id: boardMembers.id, boardId: boardMembers.boardId })
    .from(boardMembers)
    .where(and(eq(boardMembers.invitedEmail, invitedEmail), eq(boardMembers.status, 'PENDING')));

  let activated = 0;
  for (const row of pending) {
    const didActivate = await withTransaction(db, async (tx) => {
      // Re-read inside the transaction: the list above is from before it started, and
      // resurrecting a row the owner has since deleted — or re-activating one a concurrent
      // request already handled — would grant access twice.
      const [fresh] = await tx.select().from(boardMembers).where(eq(boardMembers.id, row.id));
      if (
        !fresh ||
        fresh.status !== 'PENDING' ||
        fresh.invitedEmail !== invitedEmail ||
        (fresh.userId !== null && fresh.userId !== userId)
      )
        return false;

      const board = await liveBoard(tx, fresh.boardId);
      const [user] = await tx.select().from(users).where(eq(users.id, userId));
      if (!board || !user?.emailVerified || user.email !== invitedEmail) return false;

      const timestamp = new Date();
      const bumpBoard = () =>
        tx
          .update(whiteboards)
          .set({ revision: board.revision + 1, updatedAt: timestamp })
          .where(eq(whiteboards.id, board.id));

      // The owner is OWNER through ownerId and never holds a member row; activating one
      // would list their own board twice.
      if (board.ownerId === userId) {
        await tx.delete(boardMembers).where(eq(boardMembers.id, fresh.id));
        await bumpBoard();
        return false;
      }

      const duplicates = await tx
        .select()
        .from(boardMembers)
        .where(and(eq(boardMembers.boardId, board.id), eq(boardMembers.userId, userId)));
      const [survivor, ...extra] = duplicates.filter((other) => other.id !== fresh.id);

      if (survivor) {
        await tx
          .update(boardMembers)
          .set({
            userId,
            invitedEmail: null,
            role: fresh.role,
            status: 'ACTIVE',
            activatedAt: survivor.activatedAt ?? timestamp,
          })
          .where(eq(boardMembers.id, survivor.id));
        // Any further rows are pre-existing corruption; collapse them too rather than
        // leaving orphans the DELETE route would have to reason about.
        await tx.delete(boardMembers).where(
          inArray(
            boardMembers.id,
            [fresh.id, ...extra.map((other) => other.id)],
          ),
        );
      } else {
        // invitedEmail is cleared on activation, matching upsertInvite: a row linked to a
        // uid must not also stay claimable by anyone who later verifies that address.
        await tx
          .update(boardMembers)
          .set({ userId, invitedEmail: null, status: 'ACTIVE', activatedAt: timestamp })
          .where(eq(boardMembers.id, fresh.id));
      }
      await bumpBoard();
      return true;
    });

    if (didActivate) activated += 1;
  }
  return activated;
}
