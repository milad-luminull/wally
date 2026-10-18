import { useCallback, useEffect, useRef } from 'react';
import type { PendingProps } from './pendingProps';
import type { SuggestionsController } from './useSuggestions';

/**
 * Builds what a card, a row or the note panel needs for a note's pending change, from the
 * board's one controller, so every surface reads the same mark (WALLYBOT_INLINE.md §3.4: "the
 * card updating as rows are ticked"). It also holds the countdown of the note the panel shows
 * (plan R3): reading the review takes time.
 *
 * Two holds pause a countdown: a card or row under the pointer or focus (`onPause`), and the
 * panel open on the note. Either one keeps it paused, so neither letting go resumes it while
 * the other still holds: the pointer leaving the card for the panel resumes nothing, and the
 * panel closing with the pointer still on the card resumes nothing either. A hold ends when
 * its card lets go, when the card unmounts (`usePendingPause`), or when the change stops being
 * pending.
 */
export function usePendingFor(
  suggestions: SuggestionsController,
  openNoteId: string | null,
): (noteId: string) => PendingProps | undefined {
  // Read through a ref: a card's pause handler fires long after the render that built it.
  const openNote = useRef(openNoteId);
  openNote.current = openNoteId;
  /** The notes a card or row holds paused by hover or focus. */
  const cardHolds = useRef(new Set<string>());

  const pendingFor = useCallback(
    (noteId: string): PendingProps | undefined => {
      const mark = suggestions.marks.get(noteId);
      if (!mark) return undefined;
      return {
        mark,
        onKeep: (source) => suggestions.keep(noteId, source),
        onDiscard: () => suggestions.discard(noteId, 'esc'),
        onUndo: (source) => suggestions.undo(noteId, source),
        onRemove: (field) => suggestions.remove(noteId, field),
        onSetField: (field, on) => suggestions.setField(noteId, field, on),
        onSetSubtask: (index, on) => suggestions.setSubtask(noteId, index, on),
        onSetLink: (index, on) => suggestions.setLink(noteId, index, on),
        onPause: (paused) => {
          if (paused) cardHolds.current.add(noteId);
          else cardHolds.current.delete(noteId);
          if (!paused && openNote.current === noteId) return;
          suggestions.setPaused(noteId, paused);
        },
      };
    },
    [suggestions],
  );

  // A hold belongs to a pending change: once the note's change is kept, discarded or gone, its
  // hold goes too, so a card that never reported a leave cannot hold the next change paused.
  const { marks } = suggestions;
  useEffect(() => {
    for (const noteId of cardHolds.current)
      if (marks.get(noteId)?.phase !== 'pending') cardHolds.current.delete(noteId);
  }, [marks]);

  // `setPaused` is stable (the controller's useCallback); the effect runs again only when the
  // panel opens, closes, switches note, or the open note's change stops being pending.
  const { setPaused } = suggestions;
  const openPending = openNoteId !== null && suggestions.marks.get(openNoteId)?.phase === 'pending';
  useEffect(() => {
    if (!openPending || !openNoteId) return;
    const noteId = openNoteId;
    // One set for the hook's life; read at cleanup for the holds as they are then.
    const holds = cardHolds.current;
    setPaused(noteId, true);
    return () => {
      if (!holds.has(noteId)) setPaused(noteId, false);
    };
  }, [openPending, openNoteId, setPaused]);

  return pendingFor;
}
