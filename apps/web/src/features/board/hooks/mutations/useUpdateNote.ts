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
import { useQueryKeys } from '../queryKeys';

export function useUpdateNote(boardId: string) {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();

  return useMutation({
    mutationFn: ({ noteId, input }: { noteId: string; input: NoteUpdateInput }) =>
      notesApi.update(noteId, input),
    onMutate: ({ noteId, input }) => {
      cancelNoteCaches(queryClient, keys, boardId, noteId);
      const snapshot = snapshotNoteCaches(queryClient, keys, boardId, noteId);
      patchNoteCaches(queryClient, keys, boardId, noteId, input);
      return snapshot;
    },
    onError: (_err, { noteId }, snapshot) => {
      if (snapshot) restoreNoteCaches(queryClient, keys, boardId, noteId, snapshot);
    },
    onSettled: (_data, _err, { noteId }) => settleNoteCaches(queryClient, keys, boardId, noteId),
  });
}
