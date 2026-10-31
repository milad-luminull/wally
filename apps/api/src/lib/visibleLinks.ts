import { inArray } from 'drizzle-orm';
import { notes } from './postgres/schema/index.js';
import type { Queryable } from './db/records.js';
import { canSeeNote } from './notes.js';

/** Resolve stored edges at the response boundary; hiding a target never rewrites the source. */
export async function visibleLinks(
  q: Queryable,
  note: { boardId: string; links: string[] },
  actorId: string,
): Promise<string[]> {
  if (note.links.length === 0) return [];
  const targets = await q
    .select({
      id: notes.id,
      boardId: notes.boardId,
      deletedAt: notes.deletedAt,
      visibility: notes.visibility,
      createdById: notes.createdById,
    })
    .from(notes)
    .where(inArray(notes.id, note.links));
  const visible = new Set(
    targets
      .filter(
        (target) =>
          !target.deletedAt && target.boardId === note.boardId && canSeeNote(target, actorId),
      )
      .map((target) => target.id),
  );
  // In the stored order.
  return note.links.filter((id) => visible.has(id));
}
