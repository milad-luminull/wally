import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { NoteDto, SuggestionFieldKey } from '@wally/shared';
import type { EditResult } from './InlineNoteEditor';

/** What a card or row needs to be edited in place; the board builds it per note. */
export interface InlineEditProps {
  boardId: string;
  /** This note's words are being edited: the editor stands where the card or row was. */
  editing: boolean;
  /** A double-click, F2, or a click on the title of a note under review. */
  start: () => void;
  done: (result: EditResult | null) => void;
}

/**
 * How long a click on a card the person may edit waits before it opens the sidebar: long
 * enough for the second click of a double-click, which edits in place instead. Without the
 * wait the sidebar opens on the first click and slides over the card (or, below desktop, the
 * sheet's backdrop takes the second click), so the double-click never reaches the card.
 */
export const OPEN_AFTER_CLICK_MS = 250;

/**
 * The board's one edit in place at a time (the smarter-capture spec, revision "editing the text
 * asks again"). Only a note the person may edit gets one. A finished edit that changed the
 * words is handed on with the fields its chips set; ⌘/Ctrl+Enter also opens the sidebar.
 * `openFromCard` is the card's and the row's click: it opens the sidebar once a double-click
 * can no longer follow.
 */
export function useInlineEdit(options: {
  boardId: string;
  canEdit: (note: NoteDto) => boolean;
  onEdited: (noteId: string, locked: SuggestionFieldKey[]) => void;
  onOpen: (noteId: string) => void;
}): {
  editFor: (note: NoteDto) => InlineEditProps | undefined;
  openFromCard: (note: NoteDto) => void;
} {
  const { boardId, canEdit, onEdited, onOpen } = options;
  const [editingId, setEditingId] = useState<string | null>(null);
  const pendingOpen = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelOpen = useCallback(() => {
    if (pendingOpen.current) clearTimeout(pendingOpen.current);
    pendingOpen.current = null;
  }, []);
  useEffect(() => cancelOpen, [cancelOpen]);

  const openFromCard = useCallback(
    (note: NoteDto) => {
      cancelOpen();
      if (!canEdit(note)) return onOpen(note.id);
      pendingOpen.current = setTimeout(() => {
        pendingOpen.current = null;
        onOpen(note.id);
      }, OPEN_AFTER_CLICK_MS);
    },
    [canEdit, cancelOpen, onOpen],
  );

  const editFor = useCallback(
    (note: NoteDto) =>
      canEdit(note)
        ? {
            boardId,
            editing: editingId === note.id,
            start: () => {
              cancelOpen();
              setEditingId(note.id);
            },
            done: (result: EditResult | null) => {
              setEditingId((id) => (id === note.id ? null : id));
              if (result?.changed) onEdited(note.id, result.locked);
              if (result?.open) onOpen(note.id);
            },
          }
        : undefined,
    [boardId, canEdit, cancelOpen, editingId, onEdited, onOpen],
  );
  return { editFor, openFromCard };
}

/**
 * When an edit in place ends, the focus that was in its field goes back to the card or row it
 * stood for; focus the person moved elsewhere (a click away) stays where they put it.
 */
export function useReturnFocus(editing: boolean, target: () => HTMLElement | null) {
  const wasEditing = useRef(editing);
  const find = useRef(target);
  find.current = target;
  useLayoutEffect(() => {
    const ended = wasEditing.current && !editing;
    wasEditing.current = editing;
    if (!ended) return;
    const lost = !document.activeElement || document.activeElement === document.body;
    if (lost) find.current()?.focus({ preventScroll: true });
  }, [editing]);
}
