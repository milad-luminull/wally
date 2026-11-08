import { BoardRail } from './BoardRail';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import type { NoteDto, SuggestionFieldKey, WhiteboardDto } from '@wally/shared';
import { useAuth } from '@/features/auth/AuthProvider';
import { useLanguage } from '@/i18n/languageContext';
import { EmailVerificationBanner } from '@/features/auth/EmailVerificationBanner';
import { useBreakpoint } from '@/lib/useBreakpoint';
import { BoardSkeleton } from '@/components/AppSkeleton';
import { useNotes } from './hooks/useNotes';
import { useBoardViewState } from './hooks/useBoardViewState';
import { useRememberLastBoard } from '@/lib/preferences';
import { useSetNoteVisibility } from './hooks/mutations/useSetNoteVisibility';
import { useDeleteNote } from './hooks/mutations/useDeleteNote';
import { useToggleNoteStatus } from './hooks/mutations/useToggleNoteStatus';
import { useDuplicateNote, type DuplicatePlacement } from './hooks/mutations/useDuplicateNote';
import { boardAccess, isOwner as isOwnerRole } from './util/permissions';
import {
  collectFieldKeys,
  collectFieldValues,
  filterNotes,
  relatedCounts,
  showsVisibilityFilter,
} from './util/noteDerived';
import { TopBar } from './TopBar';
import { FilterBar } from './FilterBar';
import { WallView } from './WallView/WallView';
import { ListView } from './ListView/ListView';
import { NoteDetailPanel } from './NoteDetail/NoteDetailPanel';
import { BoardLoadError } from './BoardLoadError';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { BoardCommands } from './BoardCommands';
import { WallyBox } from './WallyBox/WallyBox';
import { useWallyBox } from './WallyBox/useWallyBox';
import type { CapturePlacement } from './WallyBox/placement';
import type { BoxSlot } from './WallyBox/boxSlot';
import { useSuggestions } from './Suggestions/useSuggestions';
import { usePendingFor } from './Suggestions/usePendingFor';
import { EDIT_LOCKED, afterNoteSaves, editAskAllowed } from './Suggestions/editAsk';
import { useInlineEdit } from './Capture/inlineEdit';
import { useTidy } from './Tidy/useTidy';
import { useTidyFor } from './Tidy/useTidyFor';
import { tidyOnWall } from './Tidy/tidyOnWall';
import { undoMostRecent } from './Suggestions/keptOrder';

// Stable reference so `notes` doesn't change identity every render while the query is
// still loading — `notesQuery.data ?? []` would otherwise create a new empty array each
// time, defeating the useMemo below during that window.
const EMPTY_NOTES: NoteDto[] = [];
/**
 * Where the docked box writes: the board's next free spot, read when each note is written, in
 * the view's default zone (Today, Medium).
 */
const DOCKED_PLACEMENT: CapturePlacement = { kind: 'list' };

export function AppShell({ board, boardId }: { board: WhiteboardDto; boardId: string }) {
  const { user } = useAuth();
  const { language } = useLanguage();
  const { isDesktop, isBelowDesktop, isBelowTablet } = useBreakpoint();
  const viewState = useBoardViewState(boardId);
  const [detailExpanded, setDetailExpanded] = useState(false);
  const boardCovered = detailExpanded && isDesktop && Boolean(viewState.noteId);
  useRememberLastBoard(boardId);
  const notesQuery = useNotes(boardId);
  const toggleStatus = useToggleNoteStatus(boardId);
  const { deleteNote } = useDeleteNote(boardId);
  const setVisibility = useSetNoteVisibility(boardId);

  const access = useMemo(
    () => boardAccess(board.currentUserRole, user?.uid, viewState.visibility),
    [board.currentUserRole, user?.uid, viewState.visibility],
  );
  const isOwner = isOwnerRole(board.currentUserRole);
  const notes = notesQuery.data ?? EMPTY_NOTES;

  // Facets for the property filter, derived from the unfiltered board so choosing a value
  // never empties the list of values you could switch to.
  const fieldKeys = useMemo(() => collectFieldKeys(notes, language), [notes, language]);
  const fieldValues = useMemo(
    () => (viewState.fieldKey ? collectFieldValues(notes, viewState.fieldKey, language) : []),
    [notes, viewState.fieldKey, language],
  );
  // Each card's related count, resolved against the whole board as the panel resolves it, so
  // a filter never changes it and a dangling id never counts (the links plan's L1, L7).
  const relatedCountByNote = useMemo(() => relatedCounts(notes), [notes]);

  // Below 1080px the canvas/drag surface is desktop-only (SPEC §11 + the plan's
  // reconciled decision) — force list view there instead of just hiding the tab, and
  // never mount WallView (its DndContext/sensors never initialize on a small screen).
  const effectiveView = isDesktop ? viewState.view : 'list';

  // Wallybot's fill-in after Enter (RFC-0005-wallybot-inline.md §3.3): the capture hands over the fields
  // the person decided, the shell asks once the commit has settled, and the views draw each
  // note's pending change.
  const suggestions = useSuggestions(boardId, board.assistantEnabled, user?.uid);
  const { request: requestSuggestion, syncNotes } = suggestions;
  // Before paint, so a card whose note moved on never draws its dashed edge and ring again.
  useLayoutEffect(() => {
    if (notesQuery.data) syncNotes(notesQuery.data);
  }, [notesQuery.data, syncNotes]);
  const onCommitted = useCallback(
    (noteId: string, locked: SuggestionFieldKey[]) => requestSuggestion(noteId, locked),
    [requestSuggestion],
  );
  // An edit of the words asks again, the same way, once its saves have landed (the
  // smarter-capture spec, revision "editing the text asks again"): the words just written and
  // the horizon are locked, with any field a chip set. Read through a ref: the edit finishes
  // after the render that built this.
  const latestNotes = useRef(notes);
  latestNotes.current = notes;
  const onTextEdited = useCallback(
    (noteId: string, chipLocked: SuggestionFieldKey[] = []) => {
      const note = latestNotes.current.find((n) => n.id === noteId);
      if (!note || !editAskAllowed(note, user?.uid, board.assistantEnabled)) return;
      requestSuggestion(noteId, [...new Set([...EDIT_LOCKED, ...chipLocked])], {
        after: () => afterNoteSaves(noteId),
      });
    },
    [board.assistantEnabled, requestSuggestion, user?.uid],
  );
  // The words edited in place on a card or a row, one note at a time; a finished edit asks
  // again exactly as one in the sidebar does.
  const { editFor, openFromCard } = useInlineEdit({
    boardId,
    canEdit: access.canEditNote,
    onEdited: onTextEdited,
    onOpen: viewState.openNote,
  });
  // A click on a card or a row: it opens the sidebar once a double-click (an edit) can no
  // longer follow.
  const { openNote: openNoteNow } = viewState;
  const openNoteFromCard = useCallback(
    (noteId: string) => {
      const note = latestNotes.current.find((n) => n.id === noteId);
      if (note) openFromCard(note);
      else openNoteNow(noteId);
    },
    [openFromCard, openNoteNow],
  );
  // Read through a ref: Undo can fire long after the render that set up the toast.
  const openNoteId = useRef(viewState.noteId);
  openNoteId.current = viewState.noteId;
  // Every surface reads one mark per note; the panel open on a pending note holds its
  // countdown (R3).
  const pendingFor = usePendingFor(suggestions, viewState.noteId);

  // The Wally box (docs/superpowers/specs/2026-11-08-wally-box-design.md): one controller, drawn
  // docked at the bottom of the board, or anchored where the person double-clicked the wall.
  // A note it writes is handed on for its fill-in, as one written in place was.
  const [restored, setRestored] = useState<{ text: string; at: number } | null>(null);
  const box = useWallyBox({
    boardId,
    assistantEnabled: board.assistantEnabled,
    visibility: access.newNoteVisibility,
    onNoteCreated: onCommitted,
    onOpenNote: viewState.openNote,
    onRestoreText: (text) => setRestored({ text, at: Date.now() }),
  });
  const [anchor, setAnchor] = useState<{ key: number; placement: CapturePlacement } | null>(null);
  const dockedInput = useRef<HTMLTextAreaElement>(null);
  const startCapture = useCallback(
    (placement: CapturePlacement) =>
      setAnchor((prev) => ({ key: (prev?.key ?? 0) + 1, placement })),
    [],
  );
  const dismissAnchor = useCallback(() => {
    setAnchor(null);
    document.querySelector<HTMLElement>('[data-board-surface]')?.focus();
  }, []);
  const boxSlot = useMemo<BoxSlot | null>(
    () =>
      anchor && effectiveView === 'wall'
        ? {
            key: anchor.key,
            placement: anchor.placement,
            node: (
              <WallyBox
                boardId={boardId}
                box={box}
                mode="anchored"
                assistantEnabled={board.assistantEnabled}
                notes={notesQuery.data}
                placement={anchor.placement}
                visibility={access.newNoteVisibility}
                visibilityChosen={access.visibilityChosen}
                onOpenNote={viewState.openNote}
                onDismiss={dismissAnchor}
              />
            ),
          }
        : null,
    [
      access.newNoteVisibility,
      access.visibilityChosen,
      anchor,
      board.assistantEnabled,
      boardId,
      box,
      dismissAnchor,
      effectiveView,
      notesQuery.data,
      viewState.openNote,
    ],
  );
  const boardNotes = notes;
  const filteredNotes = useMemo(
    () => filterNotes(boardNotes, viewState, user?.uid),
    [boardNotes, viewState, user?.uid],
  );

  // Tidy on the horizon wall (RFC-0005-wallybot-inline.md §3.5): the shell counts, asks and decides;
  // the wall shows the bar and the marks. It reads the notes the wall draws, so a filter's
  // hidden notes are neither counted nor moved (R1). A note with a pending Wallybot change is
  // left out. Anywhere else, or with the assistant off, the wall gets neither (plan R4, R10).
  const busy = useMemo(() => new Set(suggestions.marks.keys()), [suggestions.marks]);
  const tidyOn = tidyOnWall(board.assistantEnabled, effectiveView, viewState.axis);
  const tidy = useTidy(boardId, tidyOn, filteredNotes, access.canEditNote, busy);
  const tidyFor = useTidyFor(tidy);

  // New note, N and the palette: the box at the bottom, ready to type in.
  const newNote = useCallback(() => {
    setAnchor(null);
    // After the render that shows the docked box again.
    setTimeout(() => dockedInput.current?.focus());
  }, []);

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
  const filterProps = {
    view: viewState,
    setQuery: viewState.setQuery,
    setPriority: viewState.setPriority,
    setMine: viewState.setMine,
    setDone: viewState.setDone,
    setFieldKey: viewState.setFieldKey,
    setFieldValue: viewState.setFieldValue,
    setVisibility: viewState.setVisibility,
    resetFilters: viewState.resetFilters,
    showVisibility: showsVisibilityFilter(notes, viewState.visibility),
    fieldKeys,
    fieldValues,
    isBelowTablet,
  };

  return (
    // dvh rather than vh: on iOS Safari the dynamic toolbar makes 100vh taller than the
    // visible viewport, which pushes the board's own scroll containers off-screen.
    <div className="board-shell relative flex h-[100dvh] flex-col overflow-hidden bg-background">
      <div inert={boardCovered}>
        <EmailVerificationBanner />
      </div>
      <div className="board-layout isolate" inert={boardCovered}>
        {isDesktop && (
          <BoardRail
            boardId={boardId}
            boardName={board.name}
            axis={viewState.axis}
            onSetAxis={viewState.setAxis}
            onNewNote={newNote}
            newNoteVisibility={access.newNoteVisibility}
          />
        )}
        <div className="board-workspace">
          <TopBar
            withRail={isDesktop}
            filters={filterProps}
            board={board}
            boardId={boardId}
            notes={boardNotes}
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
          />
          {!isDesktop && <FilterBar {...filterProps} />}

          {/* Focusable from code only: where the keyboard lands after a commit whose note has no
          card on the board. */}
          <div
            data-board-surface
            tabIndex={-1}
            className="relative flex min-h-0 flex-1 outline-none"
          >
            {notesQuery.isLoading ? (
              <BoardSkeleton columns={isDesktop ? 3 : 1} />
            ) : notesQuery.isError && !notesQuery.data ? (
              // Never drawn as an empty board: the notes did not load, and that is said.
              <BoardLoadError onRetry={() => void notesQuery.refetch()} />
            ) : effectiveView === 'wall' ? (
              <WallView
                boardId={boardId}
                notes={filteredNotes}
                totalNoteCount={boardNotes.length}
                currentUserId={user?.uid}
                axis={viewState.axis}
                selectedNoteId={viewState.noteId}
                onOpenNote={openNoteFromCard}
                onDuplicateNote={duplicateNote}
                cardActions={(note) => ({
                  onOpen: () => {
                    setDetailExpanded(false);
                    viewState.openNote(note.id);
                    if (viewState.noteId === note.id) {
                      // The editor stays mounted when Open targets the already-open note.
                      const panel = document.querySelector('.paper-detail');
                      (
                        panel?.querySelector<HTMLElement>('.note-detail-title:not(:disabled)') ??
                        panel?.querySelector<HTMLElement>('button:not(:disabled)')
                      )?.focus();
                    }
                  },
                  isDone: note.status === 'DONE',
                  ...(access.canEditShared &&
                  access.showsVisibilitySwitch(note) &&
                  note.visibility === 'SHARED'
                    ? {
                        onMakePrivate: () => {
                          if (viewState.visibility === 'shared') {
                            document.querySelector<HTMLElement>('[data-board-surface]')?.focus();
                          }
                          setVisibility.mutate({
                            noteId: note.id,
                            visibility: 'PRIVATE',
                            creator: note.createdBy,
                          });
                        },
                      }
                    : {}),
                  onExpand: () => {
                    setDetailExpanded(true);
                    viewState.openNote(note.id);
                  },
                  ...(access.canEditNote(note)
                    ? {
                        onToggleStatus: () => {
                          if (!viewState.done && note.status !== 'DONE') {
                            document.querySelector<HTMLElement>('[data-board-surface]')?.focus();
                          }
                          toggleStatus.mutate({ noteId: note.id, currentStatus: note.status });
                        },
                        onDuplicate: () => duplicateNote(note.id),
                        onDelete: () => {
                          deleteNote(note.id);
                          if (viewState.noteId === note.id) viewState.openNote(null);
                        },
                      }
                    : {}),
                })}
                access={access}
                onCapture={startCapture}
                box={boxSlot}
                pendingFor={pendingFor}
                editFor={editFor}
                relatedCounts={relatedCountByNote}
                tidyFor={tidyOn ? tidyFor : undefined}
                tidy={tidyOn ? tidy : undefined}
              />
            ) : (
              <ListView
                selectedNoteId={viewState.noteId}
                notes={filteredNotes}
                totalNoteCount={boardNotes.length}
                axis={viewState.axis}
                currentUserId={user?.uid}
                onOpenNote={openNoteFromCard}
                onToggleDone={(noteId, status) =>
                  toggleStatus.mutate({ noteId, currentStatus: status })
                }
                access={access}
                isBelowDesktop={isBelowDesktop}
                pendingFor={pendingFor}
                editFor={editFor}
                relatedCounts={relatedCountByNote}
              />
            )}
            {/* Docked at the bottom of every view; away while it is anchored on the wall. */}
            <div className={cn('wally-box-dock', boxSlot && 'hidden')}>
              <WallyBox
                boardId={boardId}
                box={box}
                mode="docked"
                assistantEnabled={board.assistantEnabled}
                notes={notesQuery.data}
                placement={DOCKED_PLACEMENT}
                visibility={access.newNoteVisibility}
                visibilityChosen={access.visibilityChosen}
                onOpenNote={viewState.openNote}
                inputRef={dockedInput}
                restored={restored}
              />
            </div>
          </div>
        </div>
      </div>

      {/* A failure inside the sidebar replaces the sidebar alone; the board stays usable. */}
      <ErrorBoundary
        key={viewState.noteId ?? 'none'}
        inline
        onClose={() => {
          setDetailExpanded(false);
          viewState.openNote(null);
        }}
      >
        <NoteDetailPanel
          noteId={viewState.noteId}
          boardId={boardId}
          boardName={board.name}
          expanded={detailExpanded}
          onExpandedChange={setDetailExpanded}
          access={access}
          axis={viewState.axis}
          isBelowDesktop={isBelowDesktop}
          onClose={() => viewState.openNote(null)}
          onDuplicate={duplicateNote}
          onOpenNote={viewState.openNote}
          currentUserId={user?.uid}
          pending={viewState.noteId ? pendingFor(viewState.noteId) : undefined}
          onTextEdited={onTextEdited}
        />
      </ErrorBoundary>

      <BoardCommands
        boardId={boardId}
        onRevealBoard={() => setDetailExpanded(false)}
        notes={boardNotes}
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
        onSetView={(value) => {
          setDetailExpanded(false);
          viewState.setView(value);
        }}
        onSetAxis={(value) => {
          setDetailExpanded(false);
          viewState.setAxis(value);
        }}
        onSetDone={(value) => {
          setDetailExpanded(false);
          viewState.setDone(value);
        }}
        onSetMine={(value) => {
          setDetailExpanded(false);
          viewState.setMine(value);
        }}
        onResetView={() => {
          setDetailExpanded(false);
          viewState.resetView();
        }}
        assistantEnabled={board.assistantEnabled}
        onUndoSuggestion={() => undoMostRecent([suggestions, tidy])}
      />
    </div>
  );
}
