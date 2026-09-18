import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { NoteStatus } from '@wally/shared';
import { notesApi } from '@/lib/resources';
import { patchNoteCaches, restoreNoteCaches, settleNoteCaches, snapshotNoteCaches } from './shared';

export function useToggleNoteStatus(boardId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ noteId, currentStatus }: { noteId: string; currentStatus: NoteStatus }) =>
      currentStatus === 'DONE' ? notesApi.reopen(noteId) : notesApi.complete(noteId),
    onMutate: async ({ noteId, currentStatus }) => {
      await queryClient.cancelQueries({ queryKey: ['notes', noteId] });
      const snapshot = snapshotNoteCaches(queryClient, boardId, noteId);
      const nextStatus: NoteStatus = currentStatus === 'DONE' ? 'OPEN' : 'DONE';
      patchNoteCaches(queryClient, boardId, noteId, {
        status: nextStatus,
        completedAt: nextStatus === 'DONE' ? new Date().toISOString() : null,
      });
      return snapshot;
    },
    onError: (_err, { noteId }, snapshot) => {
      if (snapshot) restoreNoteCaches(queryClient, boardId, noteId, snapshot);
    },
    onSettled: (_data, _err, { noteId }) => settleNoteCaches(queryClient, boardId, noteId),
  });
}
