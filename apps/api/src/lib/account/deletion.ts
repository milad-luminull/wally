import type { Firestore } from 'firebase-admin/firestore';
import type { AuthenticatedUser } from '../../plugins/auth.js';
import { now } from '../db/collections.js';
import { AppError } from '../errors.js';
import { accountDenialRef, identityDenialRef } from './access.js';

/** Persist the denial and cleanup work together before acknowledging deletion. */
export async function requestAccountDeletion(db: Firestore, user: AuthenticatedUser) {
  const age = Date.now() / 1000 - (user.authenticatedAt ?? 0);
  if (!Number.isFinite(age) || age < -30 || age > 300)
    throw new AppError(403, 'RECENT_AUTH_REQUIRED', 'Sign in again before deleting your account');
  const job = db.collection('accountDeletionJobs').doc(user.id);
  await db.runTransaction(async (tx) => {
    if ((await tx.get(job)).exists) return;
    const identities = await tx.get(db.collection('authIdentities').where('userId', '==', user.id));
    const timestamp = now();
    tx.create(job, {
      userId: user.id,
      email: user.email,
      status: 'pending',
      createdAt: timestamp,
      updatedAt: timestamp,
      attempts: 0,
      identities: identities.docs.map((doc) => ({
        issuer: doc.data().issuer,
        subject: doc.data().subject,
      })),
    });
    tx.set(accountDenialRef(db, user.id), { createdAt: timestamp });
    for (const identity of identities.docs) {
      const { issuer, subject } = identity.data();
      tx.set(identityDenialRef(db, issuer, subject), { createdAt: timestamp });
    }
    // The account denial revokes every connection atomically, including concurrent
    // establishment. Cleanup removes the records without a per-account batch limit.
  });
  return { status: 'pending' as const };
}
