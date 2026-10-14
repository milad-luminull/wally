import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, StickyNote, X } from 'lucide-react';
import type { NoteDto, NoteStatus } from '@wally/shared';
import type { BoardAxis } from '../hooks/useBoardViewState';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { groupByAxis } from '../util/noteDerived';
import type { BoardAccess } from '../util/permissions';
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
  access: BoardAccess;
  isBelowDesktop: boolean;
}

/**
 * Reads from the SAME notes the caller already fetched (BoardPage's single useNotes
 * call) — grouping/sorting is pure derived computation, so edits made here or in WandView
 * show up in both instantly without a second fetch.
 */
/** Keeps the empty-state branching out of JSX, and the keys literal so tsc checks them. */
function emptyStateKeys(boardIsEmpty: boolean, canEditShared: boolean) {
  if (!boardIsEmpty) {
    return { title: 'board.empty.filtered.title', body: 'board.empty.filtered.body' } as const;
  }
  return {
    title: 'board.empty.board.title',
    body: canEditShared ? 'board.empty.board.canEdit' : 'board.empty.board.viewer',
  } as const;
}

export function ListView({
  notes,
  totalNoteCount,
  axis,
  currentUserId,
  onOpenNote,
  onToggleDone,
  access,
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
    const keys = emptyStateKeys(totalNoteCount === 0, access.canEditShared);
    return (
      <div className="board-surface flex flex-1 items-center justify-center px-6 py-16">
        <EmptyState
          icon={<StickyNote strokeWidth={1.75} />}
          title={t(keys.title)}
          hint={t(keys.body)}
        />
      </div>
    );
  }

  return (
    <div className="wally-scroll flex-1 overflow-auto bg-background px-4 pb-10 pt-4 lg:px-6 lg:pt-6">
      <div className="mx-auto flex w-full max-w-[880px] flex-col gap-6">
        {isBelowDesktop && !hintDismissed && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface py-1.5 pl-3 pr-1.5 text-12 text-fg-3 shadow-e1">
            <Info className="h-3.5 w-3.5 shrink-0 text-fg-faint" strokeWidth={1.75} />
            <p className="min-w-0 flex-1">{t('board.hint.freeMove')}</p>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={dismissHint}
              aria-label={t('board.hint.dismiss')}
            >
              <X strokeWidth={1.75} />
            </Button>
          </div>
        )}

        {groups.map((group) => (
          <section key={group.key} className="flex flex-col gap-1.5">
            <header className="flex items-center gap-2 px-1">
              <h2 className="text-13 font-medium text-fg-1">{group.label}</h2>
              <span className="text-12 tabular-nums text-fg-faint">{group.notes.length}</span>
            </header>

            <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-e1">
              {group.notes.map((note) => (
                <NoteRow
                  key={note.id}
                  note={note}
                  currentUserId={currentUserId}
                  onOpen={() => onOpenNote(note.id)}
                  onToggleDone={() => onToggleDone(note.id, note.status)}
                  canEdit={access.canEditNote(note)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
