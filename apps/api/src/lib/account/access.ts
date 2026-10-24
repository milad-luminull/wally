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

/** Read in the same transaction as late assistant persistence: cleanup cannot race it. */
export async function assertAssistantBoardActive(
  db: Firestore,
  userId: string,
  boardId: string,
  tx: Transaction,
  expectedRevision?: number,
) {
  await assertAccountActive(db, userId, tx);
  const board = (await tx.get(db.collection('whiteboards').doc(boardId))).data();
  if (!board || board.deletedAt) throw new AppError(404, 'NOT_FOUND', 'Not found');
  await assertAccountActive(db, board.ownerId, tx);
  if (board.ownerId !== userId && !board.memberRoles?.[userId])
    throw new AppError(403, 'FORBIDDEN', 'Board access has changed');
  if (expectedRevision !== undefined && (board.revision ?? 0) !== expectedRevision)
    throw new AppError(409, 'REVISION_CONFLICT', 'Board changed while preparing the response');
}

export async function assertAssistantNotesActive(
  db: Firestore,
  userId: string,
  boardId: string,
  tx: Transaction,
  notes: readonly { id: string; revision: number }[],
) {
  for (const expected of notes) {
    const note = (await tx.get(db.collection('notes').doc(expected.id))).data();
    if (
      !note ||
      note.deletedAt ||
      note.whiteboardId !== boardId ||
      (note.visibility === 'PRIVATE' && note.createdById !== userId)
    )
      throw new AppError(404, 'NOT_FOUND', 'Not found');
    if (note.createdById) await assertAccountActive(db, note.createdById, tx);
    if ((note.revision ?? 0) !== expected.revision)
      throw new AppError(409, 'REVISION_CONFLICT', 'Note changed while preparing the response');
  }
}
