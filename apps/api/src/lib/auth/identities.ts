import { assertAccountActive, assertIdentityActive } from '../account/access.js';
import { createHash, randomUUID } from 'node:crypto';
import { INITIAL_BOARD_NAME, type Language } from '@wally/shared';
import type { VerifiedIdentity } from './auth0.js';
import type { Firestore, Timestamp } from 'firebase-admin/firestore';
import { normalizeEmail, now, usersCol, whiteboardsCol } from '../db/collections.js';
import { AppError } from '../errors.js';

export interface ExternalIdentity {
  issuer: string;
  subject: string;
}

/** Private server-side collection. No credential or email is stored here. */
export interface AuthIdentityDoc extends ExternalIdentity {
  userId: string;
  createdAt: Timestamp;
}

function identityRef(db: Firestore, identity: ExternalIdentity) {
  const id = createHash('sha256')
    .update(JSON.stringify([identity.issuer, identity.subject]))
    .digest('hex');
  return db.collection('authIdentities').doc(id);
}

export async function resolveIdentity(db: Firestore, identity: ExternalIdentity): Promise<string> {
  await assertIdentityActive(db, identity.issuer, identity.subject);
  const record = (await identityRef(db, identity).get()).data() as AuthIdentityDoc | undefined;
  if (!record || record.issuer !== identity.issuer || record.subject !== identity.subject) {
    throw new AppError(403, 'IDENTITY_NOT_LINKED', 'Account migration is required');
  }
  await assertAccountActive(db, record.userId);
  return record.userId;
}

/** Trusted migration boundary only: never expose this operation to a public request. */
export async function bindImportedIdentity(
  db: Firestore,
  identity: ExternalIdentity,
  userId: string,
): Promise<void> {
  const ref = identityRef(db, identity);
  await db.runTransaction(async (tx) => {
    await assertIdentityActive(db, identity.issuer, identity.subject, tx);
    await assertAccountActive(db, userId, tx);
    const [mapping, user] = await Promise.all([tx.get(ref), tx.get(usersCol(db).doc(userId))]);
    if (!user.exists) throw new AppError(404, 'USER_NOT_FOUND', 'Migration target does not exist');
    if (mapping.exists) {
      const stored = mapping.data() as AuthIdentityDoc;
      if (
        stored.userId !== userId ||
        stored.issuer !== identity.issuer ||
        stored.subject !== identity.subject
      ) {
        throw new AppError(409, 'IDENTITY_CONFLICT', 'Identity already belongs to another account');
      }
      return;
    }
    const record: AuthIdentityDoc = { ...identity, userId, createdAt: now() };
    tx.create(ref, record);
  });
}

/** Explicit opt-in signup only. Email collisions deny access; they never select an owner. */
export async function resolveOrCreateIdentity(
  db: Firestore,
  identity: VerifiedIdentity,
  language: Language,
): Promise<{ userId: string; created: boolean }> {
  const mappingRef = identityRef(db, identity);
  const userId = randomUUID();
  const userRef = usersCol(db).doc(userId);
  const boardRef = whiteboardsCol(db).doc(userId);
  const email = normalizeEmail(identity.email);
  return db.runTransaction(async (tx) => {
    await assertIdentityActive(db, identity.issuer, identity.subject, tx);
    const mapping = (await tx.get(mappingRef)).data() as AuthIdentityDoc | undefined;
    if (mapping) {
      await assertAccountActive(db, mapping.userId, tx);
      if (
        mapping.issuer !== identity.issuer ||
        mapping.subject !== identity.subject ||
        !(await tx.get(usersCol(db).doc(mapping.userId))).exists
      ) {
        throw new AppError(403, 'IDENTITY_NOT_LINKED', 'Account recovery is required');
      }
      return { userId: mapping.userId, created: false };
    }
    // Every application user writer stores normalizeEmail(email). Query inside the same
    // transaction as creation so concurrent first logins cannot bypass collision checks.
    const collisions = await tx.get(usersCol(db).where('email', '==', email).limit(1));
    if (!collisions.empty)
      throw new AppError(403, 'IDENTITY_NOT_LINKED', 'Account migration is required');
    const timestamp = now();
    tx.create(userRef, {
      email,
      displayName: identity.name,
      emailVerified: identity.emailVerified,
      language,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    tx.create(boardRef, {
      name: INITIAL_BOARD_NAME[language],
      ownerId: userId,
      revision: 1,
      memberRoles: {},
      shareLinkToken: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    tx.create(mappingRef, {
      issuer: identity.issuer,
      subject: identity.subject,
      userId,
      createdAt: timestamp,
    } satisfies AuthIdentityDoc);
    return { userId, created: true };
  });
}
