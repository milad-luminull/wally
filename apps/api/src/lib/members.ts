import type { Firestore } from 'firebase-admin/firestore';
import type { WhiteboardRole } from '@wally/shared';
import {
  docsWithId,
  isEmailVerified,
  liveWhiteboard,
  membersCol,
  membersGroup,
  normalizeEmail,
  now,
  stripId,
  usersCol,
  whiteboardsCol,
  withId,
} from './db/collections.js';

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
 * Two ACTIVE rows for one person on one board desync `memberRoles`: the board is listed
 * twice with conflicting roles, and removing either row revokes access the other still
 * grants. The invite's role wins the merge, because an owner's explicit per-person grant
 * outranks a bearer-token link (redeemShareLink deliberately uses the opposite rule).
 *
 * One transaction per pending row rather than a single batch: deciding merge-vs-activate
 * needs a read per row, and a `batch.update()` against a board deleted in the meantime
 * would fail the whole commit — taking every other board's activation down with it, on a
 * code path that runs inside the auth hook.
 *
 * The match is exact rather than case-insensitive, which Firestore cannot do — every write
 * path stores addresses through normalizeEmail so the two always agree.
 */
export async function activatePendingInvitesForEmail(
  db: Firestore,
  userId: string,
  email: string,
): Promise<number> {
  const invitedEmail = normalizeEmail(email);
  const pending = await membersGroup(db)
    .where('invitedEmail', '==', invitedEmail)
    .where('status', '==', 'PENDING')
    .get();
  if (pending.empty) return 0;

  let activated = 0;
  for (const row of docsWithId(pending)) {
    const boardRef = whiteboardsCol(db).doc(row.whiteboardId);
    const members = membersCol(db, row.whiteboardId);
    const pendingRef = members.doc(row.id);

    const didActivate = await db.runTransaction(async (tx) => {
      // ---- reads ----
      // Re-read inside the transaction: the collection-group result is a snapshot from
      // before it started, and resurrecting a row the owner has since deleted — or
      // re-activating one a concurrent request already handled — would grant access twice.
      const fresh = withId(await tx.get(pendingRef));
      if (
        !fresh ||
        fresh.status !== 'PENDING' ||
        fresh.invitedEmail !== invitedEmail ||
        (fresh.userId !== null && fresh.userId !== userId)
      ) {
        return false;
      }

      // The board may be gone. tx.update against a missing document fails the write, so
      // this has to be a read-and-bail rather than an optimistic update.
      const board = liveWhiteboard(await tx.get(boardRef));
      const user = withId(await tx.get(usersCol(db).doc(userId)));
      if (!board || !isEmailVerified(user) || user?.email !== invitedEmail) return false;

      // The owner is OWNER through ownerId and never holds a member row; activating one
      // would list their own board twice.
      if (board.ownerId === userId) {
        tx.delete(pendingRef);
        tx.update(boardRef, { revision: (board.revision ?? 0) + 1, updatedAt: now() });
        return false;
      }

      const rows = docsWithId(await tx.get(members));
      const duplicates = rows.filter((other) => other.id !== fresh.id && other.userId === userId);

      // ---- writes ----
      const timestamp = now();

      if (duplicates.length > 0) {
        const [survivor, ...extra] = duplicates;
        tx.set(members.doc(survivor!.id), {
          ...stripId(survivor!),
          userId,
          invitedEmail: null,
          role: fresh.role,
          status: 'ACTIVE',
          activatedAt: survivor!.activatedAt ?? timestamp,
        });
        // Any further rows are pre-existing corruption; collapse them too rather than
        // leaving orphans the DELETE route would have to reason about.
        for (const other of extra) tx.delete(members.doc(other.id));
        tx.delete(pendingRef);
      } else {
        // invitedEmail is cleared on activation, matching upsertInvite: a row linked to a
        // uid must not also stay claimable by anyone who later verifies that address.
        tx.update(pendingRef, {
          userId,
          invitedEmail: null,
          status: 'ACTIVE',
          activatedAt: timestamp,
        });
      }

      tx.update(boardRef, {
        memberRoles: { ...board.memberRoles, [userId]: fresh.role },
        revision: (board.revision ?? 0) + 1,
        updatedAt: timestamp,
      });
      return true;
    });

    if (didActivate) activated += 1;
  }
  return activated;
}
