import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { NoteDto } from '@wally/shared';
import { notesApi } from '@/lib/resources';
import { toast } from '@/lib/toast';
import { useQueryKeys } from '../queryKeys';

/**
 * Deletes a note with an undo window instead of a confirmation dialog.
 *
 * The note leaves the board immediately, and a toast offers Undo. The DELETE is only sent
 * when that toast expires (or is dismissed, or pushed out by newer ones), so Undo is a pure
 * cache restore with no server round trip. If the page is closed inside the window the
 * request is never sent and the note simply survives — the safe way for that race to go.
 */
export function useDeleteNote(boardId: string) {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  const notesKey = keys.notes(boardId);

  const mutation = useMutation({
    mutationFn: (noteId: string) => notesApi.remove(noteId),
    onSuccess: (_data, noteId) => queryClient.removeQueries({ queryKey: keys.noteDetail(noteId) }),
    // On failure the refetch brings the note back; the global handler says why.
    onSettled: () => void queryClient.invalidateQueries({ queryKey: notesKey }),
  });
  const { mutate } = mutation;

  const deleteNote = useCallback(
    (noteId: string) => {
      // The list-shaped copy, so Undo puts back exactly what the board renders from.
      const note = queryClient.getQueryData<NoteDto[]>(notesKey)?.find((n) => n.id === noteId);
      if (!note) return;
      void queryClient.cancelQueries({ queryKey: notesKey });
      queryClient.setQueryData<NoteDto[]>(notesKey, (prev) =>
        prev?.filter((n) => n.id !== note.id),
      );

      toast({
        title: note.title ? 'toast.noteDeleted' : 'toast.noteDeletedUntitled',
        values: { title: note.title },
        action: {
          label: 'toast.undo',
          onClick: () =>
            queryClient.setQueryData<NoteDto[]>(notesKey, (prev) =>
              prev && !prev.some((n) => n.id === note.id) ? [...prev, note] : prev,
            ),
        },
        onExpire: () => mutate(note.id),
      });
    },
    [mutate, notesKey, queryClient],
  );

  return { deleteNote, isPending: mutation.isPending };
}
