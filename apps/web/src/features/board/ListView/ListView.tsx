import { useMemo } from 'react';
import type { NoteDto, NoteStatus } from '@wally/shared';
import type { BoardAxis } from '../hooks/useBoardViewState';
import { groupByAxis } from '../util/noteDerived';
import { NoteRow } from './NoteRow';

interface ListViewProps {
  notes: NoteDto[];
  /** Total notes on the board before any filter/search — distinguishes "empty board" from
   * "filter hides everything" for the empty-state copy. */
  totalNoteCount: number;
  axis: BoardAxis;
  currentUserId: string | undefined;
  onOpenNote: (id: string) => void;
  onToggleDone: (noteId: string, currentStatus: NoteStatus) => void;
  canEdit: boolean;
  isBelowDesktop: boolean;
}

/**
 * Reads from the SAME notes the caller already fetched (BoardPage's single useNotes
 * call) — grouping/sorting is pure derived computation, so edits made here or in WandView
 * show up in both instantly without a second fetch.
 */
export function ListView({
  notes,
  totalNoteCount,
  axis,
  currentUserId,
  onOpenNote,
  onToggleDone,
  canEdit,
  isBelowDesktop,
}: ListViewProps) {
  const groups = useMemo(() => groupByAxis(notes, axis).filter((g) => g.notes.length > 0), [notes, axis]);

  if (notes.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 py-16 text-center">
        <p className="text-14 font-medium text-fg-1">
          {totalNoteCount === 0 ? 'Noch keine Notizen auf dieser Wand.' : 'Keine Notiz passt zum Filter.'}
        </p>
        <p className="text-13 text-fg-muted">
          {totalNoteCount === 0
            ? 'Lege über „Neue Notiz“ deine erste Notiz an.'
            : 'Passe Suche oder Filter an, um wieder Notizen zu sehen.'}
        </p>
      </div>
    );
  }

  return (
    <div className="wally-scroll flex-1 overflow-auto px-6 pb-8">
      <div className="mx-auto flex max-w-[760px] flex-col gap-8">
        {isBelowDesktop && (
          <p className="text-12 text-fg-muted">Notizen frei verschieben geht am Rechner (ab 1080px Breite).</p>
        )}
        {groups.map((group) => (
          <div key={group.key}>
            <div className="flex items-center gap-2 border-b border-border pb-2.5">
              <span className="text-11 font-semibold uppercase tracking-[0.08em] text-fg-muted">{group.label}</span>
              <span className="text-11 font-semibold text-fg-3 tabular-nums">{group.notes.length}</span>
            </div>
            {group.notes.map((note) => (
              <NoteRow
                key={note.id}
                note={note}
                currentUserId={currentUserId}
                onOpen={() => onOpenNote(note.id)}
                onToggleDone={() => onToggleDone(note.id, note.status)}
                canEdit={canEdit}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
