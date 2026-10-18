import type { Firestore, Transaction } from 'firebase-admin/firestore';
import type { NoteDoc } from './db/types.js';
import { notesCol } from './db/collections.js';
import { canSeeNote } from './notes.js';

/** Resolve stored edges at the response boundary; hiding a target never rewrites the source. */
export async function visibleLinks(
  db: Firestore,
  note: { whiteboardId: string; links?: string[] },
  actorId: string,
  tx?: Transaction,
): Promise<string[]> {
  if (!note.links?.length) return [];
  const refs = note.links.map((id) => notesCol(db).doc(id));
  const targets = await (tx ? tx.getAll(...refs) : db.getAll(...refs));
  return targets.flatMap((snapshot) => {
    const target = snapshot.data() as NoteDoc | undefined;
    return target &&
      !target.deletedAt &&
      target.whiteboardId === note.whiteboardId &&
      canSeeNote(target, actorId)
      ? [snapshot.id]
      : [];
  });
}
