import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { NoteUpdateInput } from '@wally/shared';
import { notesApi } from '@/lib/resources';
import {
  cancelNoteCaches,
  patchNoteCaches,
  restoreNoteCaches,
  settleNoteCaches,
  snapshotNoteCaches,
} from './shared';

export function useUpdateNote(boardId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ noteId, input }: { noteId: string; input: NoteUpdateInput }) =>
      notesApi.update(noteId, input),
    onMutate: ({ noteId, input }) => {
      cancelNoteCaches(queryClient, boardId, noteId);
      const snapshot = snapshotNoteCaches(queryClient, boardId, noteId);
      patchNoteCaches(queryClient, boardId, noteId, input);
      return snapshot;
    },
    onError: (_err, { noteId }, snapshot) => {
      if (snapshot) restoreNoteCaches(queryClient, boardId, noteId, snapshot);
    },
    onSettled: (_data, _err, { noteId }) => settleNoteCaches(queryClient, boardId, noteId),
  });
}
