import { horizonForDueDate, type NoteDto } from '@wally/shared';

/**
 * The notes "Tidy N notes" counts (WALLYBOT_INLINE.md §3.5, plan R2, R4), the same rule the
 * server applies: an open note the person may move, dated and in a zone its date disagrees
 * with, or undated and still in Today. A note with a pending Wallybot change is left out.
 * In board order, so the count is stable from one render to the next.
 */
export function tidyCandidateIds(
  notes: readonly NoteDto[],
  today: string,
  canMove: (note: NoteDto) => boolean,
  busy: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  for (const note of notes) {
    if (note.status !== 'OPEN' || busy.has(note.id) || !canMove(note)) continue;
    if (
      note.dueDate
        ? horizonForDueDate(note.dueDate, today) !== note.horizon
        : note.horizon === 'HEUTE'
    )
      out.push(note.id);
  }
  return out;
}

/** What the affordance remembers after a run: the candidates and their revisions, order-free (R4). */
export function candidateSignature(
  notes: readonly Pick<NoteDto, 'id' | 'revision'>[],
  ids: readonly string[],
): string {
  const revisions = new Map(notes.map((n) => [n.id, n.revision]));
  return [...ids]
    .sort()
    .map((id) => `${id}@${revisions.get(id) ?? 0}`)
    .join(',');
}
