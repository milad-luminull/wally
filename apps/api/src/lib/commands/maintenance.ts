import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import type { Database } from '../postgres/client.js';
import { withTransaction } from '../postgres/transaction.js';
import { boardCleanup, notes, whiteboards } from '../postgres/schema/index.js';
import { anyBoard, liveBoard, loadNote } from '../db/records.js';

/**
 * Finishes the work a committed command left behind, then removes the job, in one
 * transaction. Cleanup is durable and independent of receipt retention: the original
 * authorization committed the job, and cleanup does not need the initiating caller to remain
 * a member. Every step tolerates work that is already done, so a rerun after a failure is safe.
 */
export async function drainCleanupJob(db: Database, id: string): Promise<void> {
  await withTransaction(db, async (tx) => {
    const [job] = await tx.select().from(boardCleanup).where(eq(boardCleanup.id, id));
    if (!job) return;
    if (job.kind === 'note.delete') {
      const note = await loadNote(tx, job.noteId!);
      if (note && (!note.deletedAt || note.boardId !== job.boardId))
        throw new Error('Invalid deletion cleanup target');
      // Subtasks and history cascade with the note.
      await tx.delete(notes).where(eq(notes.id, job.noteId!));
    } else if (job.kind === 'member.remove') {
      // Rejoining or a new grant while the job waited must never erase a now-valid assignment.
      const board = await liveBoard(tx, job.boardId);
      if (board && board.ownerId !== job.userId && !board.memberRoles[job.userId!])
        await tx
          .update(notes)
          .set({ assigneeId: null, updatedAt: new Date(), revision: sql`${notes.revision} + 1` })
          .where(
            and(
              eq(notes.boardId, job.boardId),
              eq(notes.assigneeId, job.userId!),
              isNull(notes.deletedAt),
              // A private note stays its creator's, hidden, until they rejoin (PRIVATE_NOTES §3).
              ne(notes.visibility, 'PRIVATE'),
            ),
          );
    } else {
      const board = await anyBoard(tx, job.boardId);
      if (board && !board.deletedAt) throw new Error('Invalid board deletion cleanup target');
      // Members, the share link, notes and their subtasks and history cascade with the board.
      await tx.delete(whiteboards).where(eq(whiteboards.id, job.boardId));
    }
    await tx.delete(boardCleanup).where(eq(boardCleanup.id, id));
  });
}

export async function drainCleanup(db: Database): Promise<{ completed: number; pending: number }> {
  const jobs = await db.select({ id: boardCleanup.id }).from(boardCleanup);
  let completed = 0;
  for (const job of jobs) {
    try {
      await drainCleanupJob(db, job.id);
      completed++;
    } catch {
      /* retained for the next attempt */
    }
  }
  return { completed, pending: jobs.length - completed };
}
