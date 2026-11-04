import { and, eq } from 'drizzle-orm';
import type { ExternalIdentity } from '../auth/identities.js';
import { AUTH0_ISSUER } from '../auth/constants.js';
import type { Database } from '../postgres/client.js';
import { withTransaction } from '../postgres/transaction.js';
import { authIdentities, deletedIdentities, notes, users } from '../postgres/schema/index.js';

/** How long a deleted account's identity is refused a new account: past any access token. */
export const TOMBSTONE_MS = 60 * 60 * 1000;

/** The account's Auth0 identity. Since #98 an account has exactly one (ADR-0028). */
export async function accountIdentity(
  db: Database,
  userId: string,
): Promise<ExternalIdentity | null> {
  const [row] = await db
    .select({ issuer: authIdentities.issuer, subject: authIdentities.subject })
    .from(authIdentities)
    .where(and(eq(authIdentities.userId, userId), eq(authIdentities.issuer, AUTH0_ISSUER)));
  return row ?? null;
}

/**
 * Erases an account and everything of it, in one transaction. The foreign keys on `users` do
 * the work (their boards, notes, history, memberships and audit rows go; their assignments are
 * cleared). Their notes are deleted first: a private note must keep an assignee, and
 * PostgreSQL fires the two actions on such a row in trigger-name order, so `set null` could
 * run before `cascade` and fail the check. The tombstone stops the identity's still-valid
 * tokens from signing up again for TOMBSTONE_MS.
 *
 * Runs no external calls: withTransaction may run the body more than once.
 */
export async function eraseAccount(
  db: Database,
  userId: string,
  identity: ExternalIdentity | null,
  now: Date = new Date(),
): Promise<void> {
  await withTransaction(db, async (tx) => {
    await tx.delete(notes).where(eq(notes.createdById, userId));
    if (identity) {
      const expiresAt = new Date(now.getTime() + TOMBSTONE_MS);
      await tx
        .insert(deletedIdentities)
        .values({ ...identity, expiresAt })
        .onConflictDoUpdate({
          target: [deletedIdentities.issuer, deletedIdentities.subject],
          set: { expiresAt },
        });
    }
    await tx.delete(users).where(eq(users.id, userId));
  });
}
