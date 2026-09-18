import { useMemo } from 'react';
import type { NoteDto, WhiteboardDto } from '@wally/shared';
import { useAuth } from '@/features/auth/AuthProvider';
import { useBreakpoint } from '@/lib/useBreakpoint';
import { Skeleton } from '@/components/ui/skeleton';
import { useNotes } from './hooks/useNotes';
import { useBoardViewState } from './hooks/useBoardViewState';
import { useToggleNoteStatus } from './hooks/mutations/useToggleNoteStatus';
import { canEdit as canEditRole, isOwner as isOwnerRole } from './util/permissions';
import { filterNotes } from './util/noteDerived';
import { TopBar } from './TopBar';
import { FilterBar } from './FilterBar';
import { WandView } from './WandView/WandView';
import { ListView } from './ListView/ListView';
import { NoteDetailPanel } from './NoteDetail/NoteDetailPanel';

// Stable reference so `notes` doesn't change identity every render while the query is
// still loading — `notesQuery.data ?? []` would otherwise create a new empty array each
// time, defeating the useMemo below during that window.
const EMPTY_NOTES: NoteDto[] = [];

function BoardSkeleton() {
  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="flex items-center gap-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-6 w-24" />
      </div>
      <div className="flex flex-1 gap-4">
        <Skeleton className="h-full flex-1" />
        <Skeleton className="h-full flex-1" />
        <Skeleton className="h-full flex-1" />
      </div>
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

  // Below 1080px the canvas/drag surface is desktop-only (SPEC §11 + the plan's
  // reconciled decision) — force list view there instead of just hiding the tab, and
  // never mount WandView (its DndContext/sensors never initialize on a small screen).
  const effectiveView = isDesktop ? viewState.view : 'list';

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
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
        isBelowTablet={isBelowTablet}
      />

      <div className="flex min-h-0 flex-1">
        {notesQuery.isLoading ? (
          <BoardSkeleton />
        ) : effectiveView === 'wand' ? (
          <WandView
            boardId={boardId}
            notes={filteredNotes}
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
