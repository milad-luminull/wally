import { BoardRail } from './BoardRail';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { NoteDto, SuggestionFieldKey, WhiteboardDto } from '@wally/shared';
import { useAuth } from '@/features/auth/AuthProvider';
import { useLanguage } from '@/i18n/LanguageProvider';
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
import { nextFreeNotePosition } from './util/notePlacement';
import { boardAccess, isOwner as isOwnerRole } from './util/permissions';
import {
  collectFieldKeys,
  collectFieldValues,
  filterNotes,
  defaultZoneKey,
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
import { useCaptureSession } from './Capture/useCaptureSession';
import type { AskOptions, CapturePlacement } from './Capture/useCapture';
import { useAskSession } from './Ask/useAskSession';
import { AskCard } from './Ask/AskCard';
import { placementsTaken, type AskSlot } from './Ask/askSlot';
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

  // Wallybot's fill-in after Enter (0005-wallybot-inline.md §3.3): the capture hands over the fields
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

  // A question typed into the capture card (0005-wallybot-inline.md §3.6): the shell asks the board
  // and draws the answer where the question was written. Off means a `?` is a plain title.
  const askController = useAskSession(boardId);
  const { ask: askQuestion } = askController;
  const onAsked = useCallback(
    (question: string, placement: CapturePlacement, { takeFocus }: AskOptions) =>
      askQuestion(question, placement, takeFocus),
    [askQuestion],
  );

  // The note being written in place (0005-wallybot-inline.md §3.1). The panel no longer opens on
  // creation: only a click on the committed card, or ⌘↵ while writing, opens it.
  const {
    capture,
    captureKey,
    startCapture,
    onCaptureDone,
    onCaptureNoteId,
    onCaptureAsk,
    withoutCapturing,
  } = useCaptureSession({
    boardId,
    view: effectiveView,
    axis: viewState.axis,
    openNoteId: viewState.noteId,
    openNote: viewState.openNote,
    onCommitted,
    onAsked,
  });
  const captureAsk = board.assistantEnabled ? onCaptureAsk : undefined;
  const askSession = askController.session;
  const { setPinned: setAskPinned, dismiss: dismissAsk, pause: pauseAsk } = askController;
  const askSlot = useMemo<AskSlot | null>(
    () =>
      askSession
        ? {
            key: askSession.id,
            placement: askSession.placement,
            card: (
              <AskCard
                session={askSession}
                notes={notesQuery.data}
                layout={effectiveView === 'list' ? 'row' : 'card'}
                onOpenNote={viewState.openNote}
                onSetPinned={setAskPinned}
                onDismiss={dismissAsk}
                onPause={pauseAsk}
              />
            ),
          }
        : null,
    [
      askSession,
      dismissAsk,
      effectiveView,
      notesQuery.data,
      pauseAsk,
      setAskPinned,
      viewState.openNote,
    ],
  );
  // The views, the top bar and the palette leave the note being written to its card: it is in
  // the cache from the first keystroke, and a second copy would be clickable and openable.
  const boardNotes = useMemo(() => withoutCapturing(notes), [notes, withoutCapturing]);
  const filteredNotes = useMemo(
    () => filterNotes(boardNotes, viewState, user?.uid),
    [boardNotes, viewState, user?.uid],
  );

  // Tidy on the horizon wall (0005-wallybot-inline.md §3.5): the shell counts, asks and decides;
  // the wall shows the bar and the marks. It reads the notes the wall draws, so a filter's
  // hidden notes are neither counted nor moved (R1). A note with a pending Wallybot change is
  // left out. Anywhere else, or with the assistant off, the wall gets neither (plan R4, R10).
  const busy = useMemo(() => new Set(suggestions.marks.keys()), [suggestions.marks]);
  const tidyOn = tidyOnWall(board.assistantEnabled, effectiveView, viewState.axis);
  const tidy = useTidy(boardId, tidyOn, filteredNotes, access.canEditNote, busy);
  const tidyFor = useTidyFor(tidy);

  const askPlacement = askSession?.placement;
  const newNote = useCallback(() => {
    if (effectiveView === 'list') startCapture({ kind: 'list' });
    else if (viewState.axis === 'free') {
      // The answer card's place counts as taken: the question's draft note is gone, so the
      // notes alone would read its point as free and the new card would land on the answer.
      const at = nextFreeNotePosition(placementsTaken(notes, askPlacement));
      startCapture({ kind: 'free', x: at.freeX, y: at.freeY });
    } else
      startCapture({
        kind: 'zone',
        axis: viewState.axis,
        key: defaultZoneKey(viewState.axis),
        at: nextFreeNotePosition(notes),
      });
  }, [askPlacement, effectiveView, notes, startCapture, viewState.axis]);

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
          card on the board (useCaptureSession). */}
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
            ) : effectiveView === 'wand' ? (
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
                capture={capture}
                captureKey={captureKey}
                onCapture={startCapture}
                onCaptureDone={onCaptureDone}
                onCaptureNoteId={onCaptureNoteId}
                onCaptureAsk={captureAsk}
                ask={askSlot}
                visibility={access.newNoteVisibility}
                visibilityChosen={access.visibilityChosen}
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
                capture={
                  capture && {
                    id: captureKey,
                    boardId,
                    visibility: access.newNoteVisibility,
                    visibilityChosen: access.visibilityChosen,
                    onDone: onCaptureDone,
                    onNoteId: onCaptureNoteId,
                    onAsk: captureAsk,
                  }
                }
                ask={askSlot}
                pendingFor={pendingFor}
                editFor={editFor}
                relatedCounts={relatedCountByNote}
              />
            )}
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
