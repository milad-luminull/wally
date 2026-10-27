import {
  endOfWeek,
  horizonForDueDate,
  TIDY_MAX_UNDATED,
  TIDY_MIN_CONFIDENCE,
  type EffectiveRole,
  type NoteDto,
  type NoteHorizon,
  type TidyMoveSource,
} from '@wally/shared';
import type { ModelTidy } from './model/index.js';

export type TidyNote = Pick<
  NoteDto,
  | 'id'
  | 'title'
  | 'description'
  | 'status'
  | 'horizon'
  | 'dueDate'
  | 'revision'
  | 'visibility'
  | 'createdBy'
  | 'createdAt'
>;

export interface PlannedMove {
  noteId: string;
  baseRevision: number;
  from: NoteHorizon;
  to: NoteHorizon;
  reason: string | null;
  source: TidyMoveSource;
}

/**
 * Who may move which note, as the command layer will decide it (`rolesFor`): an owner or an
 * editor moves any note they can see, a viewer only their own private notes (plan R2, R10).
 * Proposing a move the keep would refuse is a move the person cannot make.
 */
export function mayMoveFor(role: EffectiveRole, actorId: string): (note: TidyNote) => boolean {
  if (role !== 'VIEW') return () => true;
  return (note) => note.visibility === 'PRIVATE' && note.createdBy?.id === actorId;
}

/**
 * What Tidy looks at (0005-wallybot-inline.md §3.5, plan R2, R3): among the open notes the person
 * may move, the dated ones whose zone disagrees with their date move by the rule, and the
 * undated ones still in Today, newest first and at most `TIDY_MAX_UNDATED`, go to the model.
 */
export function tidyCandidates(
  notes: TidyNote[],
  today: string,
  mayMove: (note: TidyNote) => boolean,
): { dated: PlannedMove[]; undated: TidyNote[] } {
  const open = notes.filter((note) => note.status === 'OPEN' && mayMove(note));
  const dated: PlannedMove[] = [];
  for (const note of open) {
    if (!note.dueDate) continue;
    const to = horizonForDueDate(note.dueDate, today);
    if (to !== note.horizon)
      dated.push({
        noteId: note.id,
        baseRevision: note.revision,
        from: note.horizon,
        to,
        reason: null,
        source: 'date',
      });
  }
  const undated = open
    .filter((note) => !note.dueDate && note.horizon === 'HEUTE')
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .slice(0, TIDY_MAX_UNDATED);
  return { dated, undated };
}

/**
 * The model's moves as the batch may hold them: a listed undated note, once, away from Today,
 * confident enough; the reason travels to the card (R3). On a Sunday the week ends today, so
 * "This week" can only mean a later day, which is Later (the date rule says the same).
 */
export function acceptModelMoves(
  moves: ModelTidy['moves'],
  undated: TidyNote[],
  today: string,
): PlannedMove[] {
  const sunday = endOfWeek(today) === today;
  const byId = new Map(undated.map((note) => [note.id, note]));
  const seen = new Set<string>();
  const out: PlannedMove[] = [];
  for (const move of moves) {
    const note = byId.get(move.noteId);
    if (!note || seen.has(move.noteId) || move.confidence < TIDY_MIN_CONFIDENCE) continue;
    const to: NoteHorizon = sunday && move.horizon === 'DIESE_WOCHE' ? 'SPAETER' : move.horizon;
    if (to === note.horizon) continue;
    seen.add(move.noteId);
    out.push({
      noteId: note.id,
      baseRevision: note.revision,
      from: note.horizon,
      to,
      reason: move.reason,
      source: 'words',
    });
  }
  return out;
}
