import { useQueryClient } from '@tanstack/react-query';
import { useSessionMutation as useMutation } from '@/lib/useSessionMutation';
import type { NoteUpdateInput } from '@wally/shared';
import type { MutationTicket } from '@/lib/mutationQueue';
import { notesApi } from '@/lib/resources';
import {
  captureNoteMutation,
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
    mutationFn: ({
      noteId,
      input,
      ticket,
    }: {
      noteId: string;
      input: NoteUpdateInput;
      ticket?: MutationTicket;
    }) =>
      notesApi.update(
        noteId,
        input,
        ticket ?? captureNoteMutation(queryClient, keys, boardId, noteId),
      ),
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
