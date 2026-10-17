import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NoteDto, SuggestionFieldKey } from '@wally/shared';
import type { BoardAxis, BoardView } from '../hooks/useBoardViewState';
import type { CapturePlacement } from './useCapture';

/** One note being written in place, from the gesture that asked for it until it is done. */
interface Session {
  /** Tells this capture's card and its late callbacks apart from the next capture's. */
  id: number;
  boardId: string;
  placement: CapturePlacement;
  /** Every id the note has been shown under so far: its temp id, then its real one. */
  noteIds: readonly string[];
}

/** Whether the board, as it is shown now, has a place to draw this capture. */
export function captureRendersIn(
  placement: CapturePlacement,
  view: BoardView,
  axis: BoardAxis,
): boolean {
  switch (placement.kind) {
    case 'free':
      return view === 'wand' && axis === 'free';
    case 'zone':
      return view === 'wand' && axis === placement.axis;
    case 'list':
      return view === 'list';
  }
}

const NO_NOTES: readonly string[] = [];

/** The board's own surface (AppShell), where the focus goes when the note has no card to take it. */
const BOARD_SURFACE = '[data-board-surface]';

/**
 * After a commit by keyboard, the committed note's card takes the focus (else the board), so
 * the person carries on from where they wrote. A commit by a click elsewhere already put the
 * focus where they clicked, and that is left alone.
 */
function focusCommitted(noteId: string) {
  const active = document.activeElement;
  if (active && active !== document.body) return;
  const card = document.querySelector<HTMLElement>(`[data-note-id="${CSS.escape(noteId)}"] button`);
  (card ?? document.querySelector<HTMLElement>(BOARD_SURFACE))?.focus();
}

/**
 * The shell's side of writing a note in place (WALLYBOT_INLINE.md §3.1): which capture is
 * open, which note it is writing, and who hears that it is done.
 *
 * - The note exists from the first keystroke, so the board's notes hold it while the card is
 *   still being written. `withoutCapturing` leaves it out, so the card is its only copy until
 *   the real card replaces it on commit.
 * - Every gesture opens its own capture, replacing the one before. The callbacks a card gets
 *   are bound to its own capture, so a commit still settling after its card was replaced can
 *   neither close the new card nor open the panel over it.
 * - A capture the board can no longer draw (Back to another view, a resize below desktop,
 *   another board) is closed rather than left to block the next one. Its card unmounts, which
 *   saves the words typed so far to the note.
 */
export function useCaptureSession({
  boardId,
  view,
  axis,
  openNoteId,
  openNote,
  onCommitted,
}: {
  boardId: string;
  view: BoardView;
  axis: BoardAxis;
  openNoteId: string | null;
  openNote: (noteId: string | null) => void;
  /** Hears each committed note with the fields the person decided in it (the shell asks Wallybot). */
  onCommitted?: (noteId: string, locked: SuggestionFieldKey[]) => void;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const nextId = useRef(1);
  // Read when a late callback lands, which can be long after the render that bound it.
  const currentId = useRef<number | null>(null);
  const latestOpenNote = useRef(openNote);
  latestOpenNote.current = openNote;
  const latestOnCommitted = useRef(onCommitted);
  latestOnCommitted.current = onCommitted;
  // The note just committed, focused once the board has drawn its card in the card's place.
  const committed = useRef<string | null>(null);

  const shown =
    session && session.boardId === boardId && captureRendersIn(session.placement, view, axis)
      ? session
      : null;

  const end = useCallback((id: number) => {
    if (currentId.current !== id) return false;
    currentId.current = null;
    setSession(null);
    return true;
  }, []);

  useEffect(() => {
    if (session && !shown) end(session.id);
  }, [end, session, shown]);

  useEffect(() => {
    const noteId = committed.current;
    if (session || !noteId) return;
    committed.current = null;
    focusCommitted(noteId);
  }, [session]);

  const startCapture = useCallback(
    (placement: CapturePlacement) => {
      // Closing an already closed panel would still push a history entry.
      if (openNoteId !== null) latestOpenNote.current(null);
      const id = nextId.current++;
      currentId.current = id;
      setSession({ id, boardId, placement, noteIds: NO_NOTES });
    },
    [boardId, openNoteId],
  );

  const shownId = shown?.id;
  const onCaptureDone = useCallback(
    (noteId: string | null, open: boolean, locked: SuggestionFieldKey[]) => {
      if (shownId === undefined || !end(shownId)) return;
      if (noteId) latestOnCommitted.current?.(noteId, locked);
      // The panel takes the focus itself when it opens.
      if (noteId && open) latestOpenNote.current(noteId);
      else if (noteId) committed.current = noteId;
    },
    [end, shownId],
  );
  const onCaptureNoteId = useCallback(
    (noteId: string) => {
      if (shownId === undefined) return;
      setSession((s) => (s && s.id === shownId ? { ...s, noteIds: [...s.noteIds, noteId] } : s));
    },
    [shownId],
  );

  const hidden = shown?.noteIds ?? NO_NOTES;
  const withoutCapturing = useCallback(
    (notes: NoteDto[]) => (hidden.length ? notes.filter((n) => !hidden.includes(n.id)) : notes),
    [hidden],
  );

  return useMemo(
    () => ({
      /** Where the open capture is drawn; null when none is, or the board cannot show it. */
      capture: shown?.placement ?? null,
      /** Changes with every capture, so each one gets a fresh card. */
      captureKey: shownId,
      startCapture,
      onCaptureDone,
      onCaptureNoteId,
      withoutCapturing,
    }),
    [onCaptureDone, onCaptureNoteId, shown?.placement, shownId, startCapture, withoutCapturing],
  );
}
