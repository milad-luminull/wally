import { useQueryClient } from '@tanstack/react-query';
import { useSessionMutation as useMutation } from '@/lib/useSessionMutation';
import type { NoteStatus } from '@wally/shared';
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

export function useToggleNoteStatus(boardId: string) {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();

  return useMutation({
    mutationFn: ({ noteId, currentStatus }: { noteId: string; currentStatus: NoteStatus }) =>
      currentStatus === 'DONE'
        ? notesApi.reopen(noteId, captureNoteMutation(queryClient, keys, boardId, noteId))
        : notesApi.complete(noteId, captureNoteMutation(queryClient, keys, boardId, noteId)),
    onMutate: ({ noteId, currentStatus }) => {
      cancelNoteCaches(queryClient, keys, boardId, noteId);
      const snapshot = snapshotNoteCaches(queryClient, keys, boardId, noteId);
      const nextStatus: NoteStatus = currentStatus === 'DONE' ? 'OPEN' : 'DONE';
      patchNoteCaches(queryClient, keys, boardId, noteId, {
        status: nextStatus,
        completedAt: nextStatus === 'DONE' ? new Date().toISOString() : null,
      });
      return snapshot;
    },
    onError: (_err, { noteId }, snapshot) => {
      if (snapshot) restoreNoteCaches(queryClient, keys, boardId, noteId, snapshot);
    },
    onSettled: (_data, _err, { noteId }) => settleNoteCaches(queryClient, keys, boardId, noteId),
  });
}
