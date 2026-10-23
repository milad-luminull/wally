import { createHash } from 'node:crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { AppError } from '../errors.js';

export function denialKey(kind: string, ...parts: string[]) {
  return createHash('sha256')
    .update(JSON.stringify([kind, ...parts]))
    .digest('hex');
}
export const accountDenialRef = (db: Firestore, userId: string) =>
  db.collection('accountDenials').doc(denialKey('user', userId));
export const identityDenialRef = (db: Firestore, issuer: string, subject: string) =>
  db.collection('accountDenials').doc(denialKey('identity', issuer, subject));
export async function assertAccountActive(db: Firestore, userId: string, tx?: Transaction) {
  const ref = accountDenialRef(db, userId);
  if ((await (tx ? tx.get(ref) : ref.get())).exists)
    throw new AppError(403, 'ACCOUNT_DELETED', 'This account has been deleted');
}
export async function assertIdentityActive(
  db: Firestore,
  issuer: string,
  subject: string,
  tx?: Transaction,
) {
  const ref = identityDenialRef(db, issuer, subject);
  if ((await (tx ? tx.get(ref) : ref.get())).exists)
    throw new AppError(403, 'ACCOUNT_DELETED', 'This account has been deleted');
}
