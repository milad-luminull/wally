import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import type { WhiteboardRole } from '@wally/shared';
import type { MemberDoc, WithId } from './db/types.js';
import {
  docsWithId,
  isEmailVerified,
  membersCol,
  membersGroup,
  normalizeEmail,
  now,
  shareLinksCol,
  stripId,
  usersCol,
  whiteboardsCol,
  withId,
} from './db/collections.js';

/**
 * Field-path update that keeps a whiteboard's `memberRoles` cache in step with a
 * membership write. Every caller must issue this in the SAME transaction or batch as the
 * member document it mirrors — see WhiteboardDoc.memberRoles.
 */
export function memberRoleUpdate(userId: string, role: WhiteboardRole) {
  return { [`memberRoles.${userId}`]: role };
}

/**
 * Drops a user's entry from the cache. Only ever correct once NO active member row remains
 * for them on that board — see the DELETE route, which recomputes from the surviving rows
 * rather than assuming the row it just removed was the only one. A single helper that took
 * `role | null` hid exactly that distinction, and hiding it is what let a removal revoke
 * access a second, still-live row was granting.
 */
export function memberRoleRemoval(userId: string) {
  return { [`memberRoles.${userId}`]: FieldValue.delete() };
}

/** EDIT outranks VIEW. The one place the "strongest role wins" rule is spelled out. */
export function strongestRole(roles: WhiteboardRole[]): WhiteboardRole | null {
  if (roles.length === 0) return null;
  return roles.includes('EDIT') ? 'EDIT' : 'VIEW';
}

/**
 * Creates or updates a WhiteboardMember invite. Looks up any existing row for this
 * person on this board by userId (if they already have a User record) OR invitedEmail
 * (if they were invited before signing up, or before ever authenticating against this
 * board) rather than a single keyed write — that avoids clobbering the case where a User
 * record exists but the pending invite is still keyed by invitedEmail (auto-activation
 * only links them the next time that person authenticates — see
 * activatePendingInvitesForEmail below, called from plugins/auth.ts).
 *
 * If no VERIFIED User exists yet for that email, creates a PENDING row; if one does,
 * creates/updates an ACTIVE row linked to it. Re-inviting an existing row just updates its
 * role.
 *
 * The board's members are read whole and matched in memory: a board has a handful of
 * members, and it avoids both a disjunctive query and a composite index.
 */
export async function upsertInvite(
  db: Firestore,
  whiteboardId: string,
  email: string,
  role: WhiteboardRole,
): Promise<WithId<MemberDoc>> {
  const invitedEmail = normalizeEmail(email);
  const boardRef = whiteboardsCol(db).doc(whiteboardId);
  const members = membersCol(db, whiteboardId);

  return db.runTransaction(async (tx) => {
    // No limit(1): two user records can carry the same address — an unverified sign-up
    // squatting on it and the real owner of the inbox, reachable whenever the squatter
    // later changes their own Firebase email and never authenticates again — and an
    // arbitrary first match could be the wrong one. Picking the unverified record while a
    // verified one exists would strand the invite as PENDING for a user whose record
    // already exists, where the gated sweep in plugins/auth.ts would never look again.
    const candidates = docsWithId(await tx.get(usersCol(db).where('email', '==', invitedEmail)));

    // An UNVERIFIED record proves nothing about who controls the address — Firebase permits
    // sign-up with someone else's email — so it is treated exactly like "no user record at
    // all": the invite stays PENDING, keyed by invitedEmail, and only links to a uid once
    // Firebase confirms that address (see activatePendingInvitesForEmail).
    const user = candidates.find(isEmailVerified) ?? null;
    const existing = docsWithId(await tx.get(members)).find(
      (member) =>
        (user !== null && member.userId === user.id) || member.invitedEmail === invitedEmail,
    );

    const timestamp = now();

    if (existing) {
      const next: WithId<MemberDoc> = user
        ? {
            ...existing,
            role,
            status: 'ACTIVE',
            userId: user.id,
            invitedEmail: null,
            activatedAt: existing.activatedAt ?? timestamp,
          }
        : { ...existing, role };

      tx.set(members.doc(next.id), stripId(next));
      if (next.userId) {
        tx.update(boardRef, { ...memberRoleUpdate(next.userId, role), updatedAt: timestamp });
      }
      return next;
    }

    const ref = members.doc();
    const created: MemberDoc = user
      ? {
          whiteboardId,
          userId: user.id,
          invitedEmail: null,
          role,
          status: 'ACTIVE',
          invitedAt: timestamp,
          activatedAt: timestamp,
        }
      : {
          whiteboardId,
          userId: null,
          invitedEmail,
          role,
          status: 'PENDING',
          invitedAt: timestamp,
          activatedAt: null,
        };

    tx.set(ref, created);
    if (user) {
      tx.update(boardRef, { ...memberRoleUpdate(user.id, role), updatedAt: timestamp });
    }
    return { ...created, id: ref.id };
  });
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
      if (!fresh || fresh.status !== 'PENDING' || fresh.invitedEmail !== invitedEmail) {
        return false;
      }

      // The board may be gone. tx.update against a missing document fails the write, so
      // this has to be a read-and-bail rather than an optimistic update.
      const board = withId(await tx.get(boardRef));
      if (!board) return false;

      // The owner is OWNER through ownerId and never holds a member row; activating one
      // would list their own board twice.
      if (board.ownerId === userId) {
        tx.delete(pendingRef);
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

      tx.update(boardRef, { ...memberRoleUpdate(userId, fresh.role), updatedAt: timestamp });
      return true;
    });

    if (didActivate) activated += 1;
  }
  return activated;
}

export interface ShareLinkRedeemResult {
  whiteboardId: string;
  role: WhiteboardRole;
}

/** The caller redeeming a link. `emailVerified` decides whether they may claim an invite
 *  addressed to their email — see the match below. */
export interface ShareLinkCaller {
  id: string;
  email: string;
  emailVerified: boolean;
}

/**
 * Redeems a share-link token for `caller`. Returns null if the token doesn't exist (caller
 * should 404). The owner redeeming their own board's link is a no-op (they're always OWNER
 * regardless, never get a membership). Otherwise creates or upgrades the caller's
 * membership to the link's role, but NEVER downgrades an existing EDIT membership to VIEW.
 *
 * That never-downgrade rule is deliberately the OPPOSITE of the one in
 * activatePendingInvitesForEmail, where the invite's role wins: an owner's explicit
 * per-person grant is authoritative, while a bearer token anyone can forward must not be
 * able to lower a grant. Don't "fix" one to match the other.
 */
export async function redeemShareLink(
  db: Firestore,
  token: string,
  caller: ShareLinkCaller,
): Promise<ShareLinkRedeemResult | null> {
  const callerEmail = normalizeEmail(caller.email);

  return db.runTransaction(async (tx) => {
    // ---- every read first: a transaction may not read after it writes ----
    const shareLink = withId(await tx.get(shareLinksCol(db).doc(token)));
    if (!shareLink) return null;

    const boardRef = whiteboardsCol(db).doc(shareLink.whiteboardId);
    const board = withId(await tx.get(boardRef));
    if (!board) return null;

    if (board.ownerId === caller.id) {
      return { whiteboardId: board.id, role: shareLink.role };
    }

    const members = membersCol(db, board.id);
    // Read whole and match in memory, as upsertInvite does: matching on userId OR
    // invitedEmail would otherwise need two transactional queries, and a board has a
    // handful of members.
    const rows = docsWithId(await tx.get(members));

    const existing =
      rows.find((row) => row.userId === caller.id) ??
      // Matching an email-keyed invite is what stops redemption writing a SECOND row for
      // someone who was already invited by address — two ACTIVE rows for one person on one
      // board desync memberRoles, and removing either one revokes access the other still
      // grants.
      //
      // Only a VERIFIED address may claim such a row. Without that check an attacker who
      // signed up under the victim's address could redeem any link and inherit the victim's
      // pending invite — turning a VIEW link into the EDIT the owner meant for someone else.
      //
      // `userId === null` as well: rows written before activation started clearing
      // invitedEmail still carry an address next to a foreign uid, and matching one of those
      // would hand this caller another user's membership outright.
      (caller.emailVerified
        ? rows.find((row) => row.userId === null && row.invitedEmail === callerEmail)
        : undefined) ??
      null;

    // ---- writes ----
    const timestamp = now();
    let finalRole: WhiteboardRole;

    if (existing) {
      finalRole = strongestRole([existing.role, shareLink.role])!;
      // Written unconditionally: claiming an invitedEmail row also has to set userId and
      // clear invitedEmail, which the old "only if the role changed" guard did not cover.
      tx.set(members.doc(existing.id), {
        ...stripId(existing),
        userId: caller.id,
        // A row linked to a uid carries no address, matching upsertInvite — otherwise it
        // stays claimable by anyone who later verifies that address.
        invitedEmail: null,
        role: finalRole,
        status: 'ACTIVE',
        activatedAt: existing.activatedAt ?? timestamp,
      });
    } else {
      finalRole = shareLink.role;
      tx.set(members.doc(), {
        whiteboardId: board.id,
        userId: caller.id,
        invitedEmail: null,
        role: finalRole,
        status: 'ACTIVE',
        invitedAt: timestamp,
        activatedAt: timestamp,
      });
    }

    tx.update(boardRef, { ...memberRoleUpdate(caller.id, finalRole), updatedAt: timestamp });
    return { whiteboardId: board.id, role: finalRole };
  });
}
