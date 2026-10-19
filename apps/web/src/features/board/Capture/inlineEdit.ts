import { useCallback, useState } from 'react';
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
 * The board's one edit in place at a time (the smarter-capture spec, revision "editing the text
 * asks again"). Only a note the person may edit gets one. A finished edit that changed the
 * words is handed on with the fields its chips set; ⌘/Ctrl+Enter also opens the sidebar.
 */
export function useInlineEdit(options: {
  boardId: string;
  canEdit: (note: NoteDto) => boolean;
  onEdited: (noteId: string, locked: SuggestionFieldKey[]) => void;
  onOpen: (noteId: string) => void;
}): (note: NoteDto) => InlineEditProps | undefined {
  const { boardId, canEdit, onEdited, onOpen } = options;
  const [editingId, setEditingId] = useState<string | null>(null);
  return useCallback(
    (note: NoteDto) =>
      canEdit(note)
        ? {
            boardId,
            editing: editingId === note.id,
            start: () => setEditingId(note.id),
            done: (result) => {
              setEditingId((id) => (id === note.id ? null : id));
              if (result?.changed) onEdited(note.id, result.locked);
              if (result?.open) onOpen(note.id);
            },
          }
        : undefined,
    [boardId, canEdit, editingId, onEdited, onOpen],
  );
}
