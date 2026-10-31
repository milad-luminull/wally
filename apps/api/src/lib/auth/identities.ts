import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { INITIAL_BOARD_NAME, type Language } from '@wally/shared';
import type { VerifiedIdentity } from './auth0.js';
import type { Database } from '../postgres/client.js';
import { withTransaction } from '../postgres/transaction.js';
import { authIdentities, users, whiteboards } from '../postgres/schema/index.js';
import { normalizeEmail, type Queryable } from '../db/records.js';
import { AppError } from '../errors.js';

export interface ExternalIdentity {
  issuer: string;
  subject: string;
}

const notLinked = () =>
  new AppError(403, 'IDENTITY_NOT_LINKED', 'This sign-in is not linked to a Wally account');

async function mappingFor(q: Queryable, identity: ExternalIdentity) {
  const [mapping] = await q
    .select()
    .from(authIdentities)
    .where(
      and(eq(authIdentities.issuer, identity.issuer), eq(authIdentities.subject, identity.subject)),
    );
  return mapping;
}

export async function resolveIdentity(db: Database, identity: ExternalIdentity): Promise<string> {
  const mapping = await mappingFor(db, identity);
  if (!mapping) throw notLinked();
  return mapping.userId;
}

/**
 * Links an external identity to an existing Wally user. Idempotent for the same user; refuses
 * an identity already linked to another. Server-side only (the local and E2E seeds, and
 * tests): never expose this operation to a public request.
 */
export async function bindKnownIdentity(
  db: Database,
  identity: ExternalIdentity,
  userId: string,
): Promise<void> {
  await withTransaction(db, async (tx) => {
    const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId));
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User does not exist');
    const mapping = await mappingFor(tx, identity);
    if (mapping) {
      if (mapping.userId !== userId)
        throw new AppError(409, 'IDENTITY_CONFLICT', 'Identity already belongs to another account');
      return;
    }
    await tx.insert(authIdentities).values({ ...identity, userId, createdAt: new Date() });
  });
}

/** Explicit opt-in signup only. Email collisions deny access; they never select an owner. */
export async function resolveOrCreateIdentity(
  db: Database,
  identity: VerifiedIdentity,
  language: Language,
): Promise<{ userId: string; created: boolean }> {
  const email = normalizeEmail(identity.email);
  return withTransaction(db, async (tx) => {
    const mapping = await mappingFor(tx, identity);
    // The mapping cascades with its user, so an existing mapping always has one.
    if (mapping) return { userId: mapping.userId, created: false };
    // Every user writer stores normalizeEmail(email). Checked inside the same serializable
    // transaction as creation, so concurrent first logins cannot bypass the collision check.
    const [collision] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (collision) throw notLinked();
    const userId = randomUUID();
    const timestamp = new Date();
    await tx.insert(users).values({
      id: userId,
      email,
      displayName: identity.name,
      emailVerified: identity.emailVerified,
      language,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await tx.insert(whiteboards).values({
      id: userId,
      name: INITIAL_BOARD_NAME[language],
      ownerId: userId,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await tx.insert(authIdentities).values({
      issuer: identity.issuer,
      subject: identity.subject,
      userId,
      createdAt: timestamp,
    });
    return { userId, created: true };
  });
}
