import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UserSummary } from '@wally/shared';
import { notesApi } from '@/lib/resources';
import { cancelNoteCaches, patchNoteCaches, restoreNoteCaches, settleNoteCaches, snapshotNoteCaches } from './shared';

export function useAssignNote(boardId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ noteId, assigneeId }: { noteId: string; assigneeId: string | null; optimisticAssignee?: UserSummary | null }) =>
      notesApi.assign(noteId, assigneeId),
    onMutate: ({ noteId, optimisticAssignee }) => {
      cancelNoteCaches(queryClient, boardId, noteId);
      const snapshot = snapshotNoteCaches(queryClient, boardId, noteId);
      patchNoteCaches(queryClient, boardId, noteId, { assignee: optimisticAssignee ?? null });
      return snapshot;
    },
    onError: (_err, { noteId }, snapshot) => {
      if (snapshot) restoreNoteCaches(queryClient, boardId, noteId, snapshot);
    },
    onSettled: (_data, _err, { noteId }) => settleNoteCaches(queryClient, boardId, noteId),
  });
}
