import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { AppError } from '../errors.js';

/**
 * Re-checked in the same transaction as late assistant persistence: the board, the caller's
 * access and the revision the model worked from must all still hold when the result lands.
 */
export async function assertAssistantBoardActive(
  db: Firestore,
  userId: string,
  boardId: string,
  tx: Transaction,
  expectedRevision?: number,
) {
  const board = (await tx.get(db.collection('whiteboards').doc(boardId))).data();
  if (!board || board.deletedAt) throw new AppError(404, 'NOT_FOUND', 'Not found');
  if (board.ownerId !== userId && !board.memberRoles?.[userId])
    throw new AppError(403, 'FORBIDDEN', 'Board access has changed');
  if (expectedRevision !== undefined && (board.revision ?? 0) !== expectedRevision)
    throw new AppError(409, 'REVISION_CONFLICT', 'Board changed while preparing the response');
}

/** The notes the model read must still exist, be visible to the caller and be unchanged. */
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
    if ((note.revision ?? 0) !== expected.revision)
      throw new AppError(409, 'REVISION_CONFLICT', 'Note changed while preparing the response');
  }
}
