import { useCallback, useMemo, useRef } from 'react';
import type { NoteDto, WhiteboardDto } from '@wally/shared';
import { useAuth } from '@/features/auth/AuthProvider';
import { EmailVerificationBanner } from '@/features/auth/EmailVerificationBanner';
import { useBreakpoint } from '@/lib/useBreakpoint';
import { BoardSkeleton } from '@/components/AppSkeleton';
import { useNotes } from './hooks/useNotes';
import { useBoardViewState } from './hooks/useBoardViewState';
import { useRememberLastBoard } from '@/lib/preferences';
import { useToggleNoteStatus } from './hooks/mutations/useToggleNoteStatus';
import { useDuplicateNote, type DuplicatePlacement } from './hooks/mutations/useDuplicateNote';
import { nextFreeNotePosition } from './util/notePlacement';
import { boardAccess, isOwner as isOwnerRole } from './util/permissions';
import {
  collectFieldKeys,
  collectFieldValues,
  filterNotes,
  firstZoneKey,
  showsVisibilityFilter,
} from './util/noteDerived';
import { TopBar } from './TopBar';
import { FilterBar } from './FilterBar';
import { WandView } from './WandView/WandView';
import { ListView } from './ListView/ListView';
import { NoteDetailPanel } from './NoteDetail/NoteDetailPanel';
import { AssistantPanel } from './Assistant/AssistantPanel';
import { BoardCommands } from './BoardCommands';
import { useCaptureSession } from './Capture/useCaptureSession';

// Stable reference so `notes` doesn't change identity every render while the query is
// still loading — `notesQuery.data ?? []` would otherwise create a new empty array each
// time, defeating the useMemo below during that window.
const EMPTY_NOTES: NoteDto[] = [];

export function AppShell({ board, boardId }: { board: WhiteboardDto; boardId: string }) {
  const { user } = useAuth();
  const { isDesktop, isBelowDesktop, isBelowTablet } = useBreakpoint();
  const viewState = useBoardViewState(boardId);
  useRememberLastBoard(boardId);
  const notesQuery = useNotes(boardId);
  const toggleStatus = useToggleNoteStatus(boardId);

  const access = useMemo(
    () => boardAccess(board.currentUserRole, user?.uid, viewState.visibility),
    [board.currentUserRole, user?.uid, viewState.visibility],
  );
  const isOwner = isOwnerRole(board.currentUserRole);
  const notes = notesQuery.data ?? EMPTY_NOTES;

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

  // The note being written in place (WALLYBOT_INLINE.md §3.1). The panel no longer opens on
  // creation: only a click on the committed card, or ⌘↵ while writing, opens it.
  const { capture, captureKey, startCapture, onCaptureDone, onCaptureNoteId, withoutCapturing } =
    useCaptureSession({
      boardId,
      view: effectiveView,
      axis: viewState.axis,
      openNoteId: viewState.noteId,
      openNote: viewState.openNote,
    });
  // The views leave the note being written to its card: it is in the cache from the first
  // keystroke, and a second copy beside the card would be clickable and draggable.
  const boardNotes = useMemo(() => withoutCapturing(notes), [notes, withoutCapturing]);
  const filteredNotes = useMemo(
    () => filterNotes(boardNotes, viewState, user?.uid),
    [boardNotes, viewState, user?.uid],
  );

  const newNote = useCallback(() => {
    if (effectiveView === 'list') startCapture({ kind: 'list' });
    else if (viewState.axis === 'free') {
      const at = nextFreeNotePosition(notes);
      startCapture({ kind: 'free', x: at.freeX, y: at.freeY });
    } else
      startCapture({
        kind: 'zone',
        axis: viewState.axis,
        key: firstZoneKey(viewState.axis),
        at: nextFreeNotePosition(notes),
      });
  }, [effectiveView, notes, startCapture, viewState.axis]);

  // Read through a ref: Undo can fire long after the render that set up the toast.
  const openNoteId = useRef(viewState.noteId);
  openNoteId.current = viewState.noteId;
  const { openNote } = viewState;
  const { duplicate } = useDuplicateNote(boardId, {
    onUndo: (copyId) => {
      if (openNoteId.current === copyId) openNote(null);
    },
  });
  /** The panel button and ⌘D open the copy, ready to edit. An Alt-drag places one and
   * leaves the panel alone, since the user is busy arranging cards. */
  const duplicateNote = useCallback(
    (noteId: string, placement?: DuplicatePlacement) => {
      const source = notes.find((n) => n.id === noteId);
      if (!source || !access.canEditNote(source)) return;
      duplicate(noteId, placement, placement ? undefined : { onSuccess: (n) => openNote(n.id) });
    },
    [access, duplicate, notes, openNote],
  );
  const openedNote = notes.find((n) => n.id === viewState.noteId);

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
        newNoteVisibility={access.newNoteVisibility}
        isOwner={isOwner}
        isCustomized={viewState.isCustomized}
        onSetView={viewState.setView}
        onSetAxis={viewState.setAxis}
        onResetView={viewState.resetView}
        onNewNote={newNote}
        assistantEnabled={board.assistantEnabled}
        onOpenAssistant={() => viewState.openAsk(true)}
      />
      <FilterBar
        view={viewState}
        setQuery={viewState.setQuery}
        setPriority={viewState.setPriority}
        setMine={viewState.setMine}
        setDone={viewState.setDone}
        setFieldKey={viewState.setFieldKey}
        setFieldValue={viewState.setFieldValue}
        setVisibility={viewState.setVisibility}
        resetFilters={viewState.resetFilters}
        showVisibility={showsVisibilityFilter(notes, viewState.visibility)}
        fieldKeys={fieldKeys}
        fieldValues={fieldValues}
        isBelowTablet={isBelowTablet}
      />

      <div className="relative flex min-h-0 flex-1">
        {notesQuery.isLoading ? (
          <BoardSkeleton columns={isDesktop ? 3 : 1} />
        ) : effectiveView === 'wand' ? (
          <WandView
            boardId={boardId}
            notes={filteredNotes}
            totalNoteCount={boardNotes.length}
            currentUserId={user?.uid}
            axis={viewState.axis}
            selectedNoteId={viewState.noteId}
            onOpenNote={viewState.openNote}
            onDuplicateNote={duplicateNote}
            access={access}
            capture={capture}
            captureKey={captureKey}
            onCapture={startCapture}
            onCaptureDone={onCaptureDone}
            onCaptureNoteId={onCaptureNoteId}
            visibility={access.newNoteVisibility}
          />
        ) : (
          <ListView
            notes={filteredNotes}
            totalNoteCount={boardNotes.length}
            axis={viewState.axis}
            currentUserId={user?.uid}
            onOpenNote={viewState.openNote}
            onToggleDone={(noteId, status) =>
              toggleStatus.mutate({ noteId, currentStatus: status })
            }
            access={access}
            isBelowDesktop={isBelowDesktop}
            capture={
              capture && {
                id: captureKey,
                boardId,
                visibility: access.newNoteVisibility,
                onDone: onCaptureDone,
                onNoteId: onCaptureNoteId,
              }
            }
          />
        )}

        <NoteDetailPanel
          noteId={viewState.noteId}
          boardId={boardId}
          access={access}
          axis={viewState.axis}
          isBelowDesktop={isBelowDesktop}
          onClose={() => viewState.openNote(null)}
          onDuplicate={duplicateNote}
          currentUserId={user?.uid}
        />

        {/* Off means nothing: no panel even when the link carries ?ask=1. */}
        {board.assistantEnabled && (
          <AssistantPanel
            open={viewState.askOpen}
            boardId={boardId}
            isBelowDesktop={isBelowDesktop}
            onClose={() => viewState.openAsk(false)}
            onOpenNote={viewState.openNote}
          />
        )}
      </div>

      <BoardCommands
        boardId={boardId}
        notes={notes}
        view={effectiveView}
        axis={viewState.axis}
        done={viewState.done}
        mine={viewState.mine}
        isDesktop={isDesktop}
        newNoteVisibility={access.newNoteVisibility}
        canDuplicateOpenNote={Boolean(openedNote && access.canEditNote(openedNote))}
        noteOpen={viewState.noteId !== null}
        onNewNote={newNote}
        onDuplicateNote={() => viewState.noteId && duplicateNote(viewState.noteId)}
        onOpenNote={viewState.openNote}
        onCloseNote={() => viewState.openNote(null)}
        onSetView={viewState.setView}
        onSetAxis={viewState.setAxis}
        onSetDone={viewState.setDone}
        onSetMine={viewState.setMine}
        onResetView={viewState.resetView}
        assistantEnabled={board.assistantEnabled}
        onOpenAssistant={() => viewState.openAsk(true)}
      />
    </div>
  );
}
