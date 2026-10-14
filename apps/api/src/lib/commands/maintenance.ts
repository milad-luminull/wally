import type { Firestore } from 'firebase-admin/firestore';
import {
  docsWithId,
  liveWhiteboard,
  membersCol,
  notesCol,
  now,
  shareLinksCol,
  whiteboardsCol,
  withId,
} from '../db/collections.js';
import { revisionOf } from './context.js';
import { rolesFromMembers } from './administration.js';

/** Cleanup is durable and independent of receipt retention. The original authorization
 * committed the job; cleanup does not need the initiating caller to remain a member. */
export async function drainCleanupJob(db: Firestore, id: string): Promise<void> {
  const ref = db.collection('boardCleanup').doc(id);
  const job = (await ref.get()).data();
  if (!job) return;
  if (job.kind === 'note.delete') {
    const noteRef = notesCol(db).doc(job.noteId);
    const note = (await noteRef.get()).data();
    if (note && (!note.deletedAt || note.whiteboardId !== job.boardId))
      throw new Error('Invalid deletion cleanup target');
    await db.recursiveDelete(noteRef);
  } else if (job.kind === 'member.remove') {
    // Use one transaction per note: rejoining or reassignment while cleanup is running
    // must never erase a now-valid assignment. Query results are only candidate IDs.
    const assigned = await notesCol(db)
      .where('whiteboardId', '==', job.boardId)
      .where('assigneeId', '==', job.userId)
      .get();
    for (const row of assigned.docs)
      await db.runTransaction(async (tx) => {
        const board = liveWhiteboard(await tx.get(whiteboardsCol(db).doc(job.boardId)));
        const note = withId(await tx.get(row.ref));
        if (
          !board ||
          !note ||
          note.deletedAt ||
          note.whiteboardId !== board.id ||
          note.assigneeId !== job.userId ||
          board.ownerId === job.userId ||
          board.memberRoles[job.userId]
        )
          return;
        tx.update(row.ref, { assigneeId: null, updatedAt: now(), revision: revisionOf(note) + 1 });
      });
  } else throw new Error('Unknown cleanup kind');
  await ref.delete();
}

export async function drainCleanup(db: Firestore): Promise<{ completed: number; pending: number }> {
  const jobs = await db.collection('boardCleanup').get();
  let completed = 0;
  for (const job of jobs.docs) {
    try {
      await drainCleanupJob(db, job.id);
      completed++;
    } catch {
      /* retained for the next attempt */
    }
  }
  return { completed, pending: jobs.size - completed };
}

/** Dry run by default. Every applied repair re-reads its inputs transactionally. */
export async function reconcileBoards(
  db: Firestore,
  apply = false,
): Promise<{ roleCaches: number; orphanLinks: number }> {
  let roleCaches = 0,
    orphanLinks = 0;
  for (const ref of await whiteboardsCol(db).listDocuments()) {
    const changed = await db.runTransaction(async (tx) => {
      // A tombstoned board is finished by its own cleanup job, not repaired here.
      const board = liveWhiteboard(await tx.get(ref));
      if (!board) return false;
      const roles = rolesFromMembers(
        docsWithId(await tx.get(membersCol(db, board.id))),
        board.ownerId,
      );
      const same =
        Object.keys(roles).length === Object.keys(board.memberRoles).length &&
        Object.entries(roles).every(([uid, role]) => board.memberRoles[uid] === role);
      if (!same && apply)
        tx.update(ref, { memberRoles: roles, revision: revisionOf(board) + 1, updatedAt: now() });
      return !same;
    });
    if (changed) roleCaches++;
  }
  for (const ref of await shareLinksCol(db).listDocuments()) {
    const orphan = await db.runTransaction(async (tx) => {
      const link = withId(await tx.get(ref));
      if (!link) return false;
      const board = liveWhiteboard(await tx.get(whiteboardsCol(db).doc(link.whiteboardId)));
      if (board?.shareLinkToken === link.id) return false;
      if (apply) tx.delete(ref);
      return true;
    });
    if (orphan) orphanLinks++;
  }
  return { roleCaches, orphanLinks };
}
