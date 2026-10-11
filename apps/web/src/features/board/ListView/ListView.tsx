import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, StickyNote, X } from 'lucide-react';
import type { NoteDto, NoteStatus } from '@wally/shared';
import type { BoardAxis } from '../hooks/useBoardViewState';
import { cn } from '@/lib/cn';
import { groupByAxis } from '../util/noteDerived';
import { NoteRow } from './NoteRow';

const FREE_MOVE_HINT_KEY = 'wally:hint:free-move-desktop';

/**
 * A hint the reader only needs once, remembered per browser.
 *
 * This one sat undismissable at the top of the list on every load, in the most valuable
 * strip of a phone screen, to explain a capability that isn't reachable from a phone at
 * all. Storage can throw (private mode, blocked site data), in which case the hint simply
 * returns on the next load rather than the view failing to render.
 */
function useDismissibleHint(storageKey: string) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(storageKey) === '1';
    } catch {
      return false;
    }
  });

  function dismiss() {
    setDismissed(true);
    try {
      window.localStorage.setItem(storageKey, '1');
    } catch {
      /* Not persistable here; the dismissal still holds for this session. */
    }
  }

  return [dismissed, dismiss] as const;
}

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
/** Keeps the empty-state branching out of JSX, and the keys literal so tsc checks them. */
function emptyStateKeys(boardIsEmpty: boolean, canEdit: boolean) {
  if (!boardIsEmpty) {
    return { title: 'board.empty.filtered.title', body: 'board.empty.filtered.body' } as const;
  }
  return {
    title: 'board.empty.board.title',
    body: canEdit ? 'board.empty.board.canEdit' : 'board.empty.board.readOnly',
  } as const;
}

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
  const { t } = useTranslation();
  // `t` belongs in these deps: react-i18next returns a new reference after languageChanged, so
  // including it is what makes the group labels re-derive when the language changes.
  const groups = useMemo(
    () => groupByAxis(notes, axis, t).filter((g) => g.notes.length > 0),
    [notes, axis, t],
  );
  const [hintDismissed, dismissHint] = useDismissibleHint(FREE_MOVE_HINT_KEY);

  if (notes.length === 0) {
    const keys = emptyStateKeys(totalNoteCount === 0, canEdit);
    return (
      <div className="board-surface flex flex-1 items-center justify-center px-6 py-16">
        <div className="flex max-w-sm flex-col items-center gap-2.5 text-center">
          <span className="mb-1 flex h-12 w-12 items-center justify-center rounded-2xl bg-inset text-fg-faint">
            <StickyNote className="h-5 w-5" strokeWidth={1.7} />
          </span>
          <p className="font-head text-22 font-semibold text-fg-1">{t(keys.title)}</p>
          <p className="text-14 text-fg-muted">{t(keys.body)}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="board-surface wally-scroll flex-1 overflow-auto px-5 pb-10 pt-5 lg:px-6 lg:pt-6">
      <div className="mx-auto flex w-full max-w-[780px] flex-col gap-7">
        {isBelowDesktop && !hintDismissed && (
          <div className="flex items-start gap-2 rounded-xl border border-border-subtle bg-[color:var(--zone-surface)] px-3.5 py-2.5 text-12 text-fg-muted">
            <Info className="mt-px h-3.5 w-3.5 shrink-0 text-fg-faint" strokeWidth={1.9} />
            <p className="min-w-0 flex-1">{t('board.hint.freeMove')}</p>
            <button
              type="button"
              onClick={dismissHint}
              aria-label={t('board.hint.dismiss')}
              className={cn(
                '-my-1 -mr-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-faint',
                'transition-colors duration-150 ease-ds hover:bg-inset hover:text-fg-1',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)]',
                '[@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9',
              )}
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
        )}

        {groups.map((group) => (
          <section
            key={group.key}
            className="overflow-hidden rounded-2xl border border-border-subtle bg-card shadow-e1"
          >
            <header className="flex items-center gap-2 border-b border-border-subtle bg-surface-alt px-4 py-2.5">
              <h2 className="text-12 font-bold uppercase tracking-[0.09em] text-fg-muted">
                {group.label}
              </h2>
              <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-inset px-1.5 text-12 font-semibold tabular-nums text-fg-muted">
                {group.notes.length}
              </span>
            </header>

            <div>
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
          </section>
        ))}
      </div>
    </div>
  );
}
