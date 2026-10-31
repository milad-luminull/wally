import { inArray } from 'drizzle-orm';
import { AppError } from '../errors.js';
import { liveBoard } from '../db/records.js';
import type { Transaction } from '../postgres/transaction.js';
import { notes as notesTable } from '../postgres/schema/index.js';

/**
 * Re-checked in the same transaction as late assistant persistence: the board, the caller's
 * access and the revision the model worked from must all still hold when the result lands.
 */
export async function assertAssistantBoardActive(
  tx: Transaction,
  userId: string,
  boardId: string,
  expectedRevision?: number,
) {
  const board = await liveBoard(tx, boardId);
  if (!board) throw new AppError(404, 'NOT_FOUND', 'Not found');
  if (board.ownerId !== userId && !board.memberRoles[userId])
    throw new AppError(403, 'FORBIDDEN', 'Board access has changed');
  if (expectedRevision !== undefined && board.revision !== expectedRevision)
    throw new AppError(409, 'REVISION_CONFLICT', 'Board changed while preparing the response');
}

/** The notes the model read must still exist, be visible to the caller and be unchanged. */
export async function assertAssistantNotesActive(
  tx: Transaction,
  userId: string,
  boardId: string,
  notes: readonly { id: string; revision: number }[],
) {
  const rows =
    notes.length === 0
      ? []
      : await tx
          .select({
            id: notesTable.id,
            boardId: notesTable.boardId,
            deletedAt: notesTable.deletedAt,
            visibility: notesTable.visibility,
            createdById: notesTable.createdById,
            revision: notesTable.revision,
          })
          .from(notesTable)
          .where(
            inArray(
              notesTable.id,
              notes.map((note) => note.id),
            ),
          );
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const expected of notes) {
    const note = byId.get(expected.id);
    if (
      !note ||
      note.deletedAt ||
      note.boardId !== boardId ||
      (note.visibility === 'PRIVATE' && note.createdById !== userId)
    )
      throw new AppError(404, 'NOT_FOUND', 'Not found');
    if (note.revision !== expected.revision)
      throw new AppError(409, 'REVISION_CONFLICT', 'Note changed while preparing the response');
  }
}
