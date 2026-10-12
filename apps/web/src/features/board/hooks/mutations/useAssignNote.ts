import { useQueryClient } from '@tanstack/react-query';
import { useSessionMutation as useMutation } from '@/lib/useSessionMutation';
import type { UserSummary } from '@wally/shared';
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

export function useAssignNote(boardId: string) {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();

  return useMutation({
    mutationFn: ({
      noteId,
      assigneeId,
    }: {
      noteId: string;
      assigneeId: string | null;
      optimisticAssignee?: UserSummary | null;
    }) =>
      notesApi.assign(noteId, assigneeId, captureNoteMutation(queryClient, keys, boardId, noteId)),
    onMutate: ({ noteId, optimisticAssignee }) => {
      cancelNoteCaches(queryClient, keys, boardId, noteId);
      const snapshot = snapshotNoteCaches(queryClient, keys, boardId, noteId);
      patchNoteCaches(queryClient, keys, boardId, noteId, { assignee: optimisticAssignee ?? null });
      return snapshot;
    },
    onError: (_err, { noteId }, snapshot) => {
      if (snapshot) restoreNoteCaches(queryClient, keys, boardId, noteId, snapshot);
    },
    onSettled: (_data, _err, { noteId }) => settleNoteCaches(queryClient, keys, boardId, noteId),
  });
}
