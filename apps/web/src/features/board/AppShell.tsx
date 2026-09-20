import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { NoteDto, WhiteboardDto } from '@wally/shared';
import { useAuth } from '@/features/auth/AuthProvider';
import { EmailVerificationBanner } from '@/features/auth/EmailVerificationBanner';
import { useBreakpoint } from '@/lib/useBreakpoint';
import { Skeleton } from '@/components/ui/skeleton';
import { useNotes } from './hooks/useNotes';
import { useBoardViewState } from './hooks/useBoardViewState';
import { useToggleNoteStatus } from './hooks/mutations/useToggleNoteStatus';
import { canEdit as canEditRole, isOwner as isOwnerRole } from './util/permissions';
import { collectFieldKeys, collectFieldValues, filterNotes } from './util/noteDerived';
import { TopBar } from './TopBar';
import { FilterBar } from './FilterBar';
import { WandView } from './WandView/WandView';
import { ListView } from './ListView/ListView';
import { NoteDetailPanel } from './NoteDetail/NoteDetailPanel';

// Stable reference so `notes` doesn't change identity every render while the query is
// still loading — `notesQuery.data ?? []` would otherwise create a new empty array each
// time, defeating the useMemo below during that window.
const EMPTY_NOTES: NoteDto[] = [];

/** Mirrors the real zone/card geometry rather than showing three generic blocks, so the
 * board does not visibly re-flow the moment notes arrive. */
function BoardSkeleton({ columns }: { columns: number }) {
  const { t } = useTranslation();

  return (
    <div className="board-surface flex min-w-0 flex-1 gap-4 overflow-hidden p-5 lg:p-6" role="status" aria-label={t('common.loading')}>
      {Array.from({ length: columns }).map((_, column) => (
        <div
          key={column}
          className="flex h-full w-[288px] shrink-0 flex-col rounded-2xl border border-border-subtle bg-[color:var(--zone-surface)]"
        >
          <div className="flex items-center gap-2 px-4 pb-2 pt-3.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-[18px] w-[18px] rounded-full" />
          </div>
          <div className="flex flex-col gap-3 px-3 pb-3">
            {Array.from({ length: 3 - column }).map((__, card) => (
              <Skeleton key={card} className="h-[86px] w-[248px] rounded-xl" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function AppShell({ board, boardId }: { board: WhiteboardDto; boardId: string }) {
  const { user } = useAuth();
  const { isDesktop, isBelowDesktop, isBelowTablet } = useBreakpoint();
  const viewState = useBoardViewState();
  const notesQuery = useNotes(boardId);
  const toggleStatus = useToggleNoteStatus(boardId);

  const canEdit = canEditRole(board.currentUserRole);
  const isOwner = isOwnerRole(board.currentUserRole);
  const notes = notesQuery.data ?? EMPTY_NOTES;

  const filteredNotes = useMemo(() => filterNotes(notes, viewState, user?.uid), [notes, viewState, user?.uid]);
  // Facets for the property filter, derived from the unfiltered board so choosing a value
  // never empties the list of values you could switch to.
  const fieldKeys = useMemo(() => collectFieldKeys(notes), [notes]);
  const fieldValues = useMemo(
    () => (viewState.fieldKey ? collectFieldValues(notes, viewState.fieldKey) : []),
    [notes, viewState.fieldKey],
  );

  // Below 1080px the canvas/drag surface is desktop-only (SPEC §11 + the plan's
  // reconciled decision) — force list view there instead of just hiding the tab, and
  // never mount WandView (its DndContext/sensors never initialize on a small screen).
  const effectiveView = isDesktop ? viewState.view : 'list';

  return (
    // dvh rather than vh: on iOS Safari the dynamic toolbar makes 100vh taller than the
    // visible viewport, which pushes the board's own scroll containers off-screen.
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background">
      <EmailVerificationBanner />
      <TopBar
        board={board}
        boardId={boardId}
        notes={notes}
        view={effectiveView}
        axis={viewState.axis}
        isDesktop={isDesktop}
        isBelowTablet={isBelowTablet}
        canEdit={canEdit}
        isOwner={isOwner}
        onSetView={viewState.setView}
        onSetAxis={viewState.setAxis}
        onOpenNote={viewState.openNote}
      />
      <FilterBar
        view={viewState}
        setQuery={viewState.setQuery}
        setPriority={viewState.setPriority}
        setMine={viewState.setMine}
        setDone={viewState.setDone}
        setFieldKey={viewState.setFieldKey}
        setFieldValue={viewState.setFieldValue}
        fieldKeys={fieldKeys}
        fieldValues={fieldValues}
        isBelowTablet={isBelowTablet}
      />

      <div className="flex min-h-0 flex-1">
        {notesQuery.isLoading ? (
          <BoardSkeleton columns={isDesktop ? 3 : 1} />
        ) : effectiveView === 'wand' ? (
          <WandView
            boardId={boardId}
            notes={filteredNotes}
            totalNoteCount={notes.length}
            currentUserId={user?.uid}
            axis={viewState.axis}
            selectedNoteId={viewState.noteId}
            onOpenNote={viewState.openNote}
            canEdit={canEdit}
          />
        ) : (
          <ListView
            notes={filteredNotes}
            totalNoteCount={notes.length}
            axis={viewState.axis}
            currentUserId={user?.uid}
            onOpenNote={viewState.openNote}
            onToggleDone={(noteId, status) => toggleStatus.mutate({ noteId, currentStatus: status })}
            canEdit={canEdit}
            isBelowDesktop={isBelowDesktop}
          />
        )}

        <NoteDetailPanel
          noteId={viewState.noteId}
          boardId={boardId}
          canEdit={canEdit}
          axis={viewState.axis}
          isBelowDesktop={isBelowDesktop}
          onClose={() => viewState.openNote(null)}
        />
      </div>
    </div>
  );
}
