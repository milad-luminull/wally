import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { NoteMoveInput } from '@wally/shared';
import { notesApi } from '@/lib/resources';
import { patchNoteCaches, restoreNoteCaches, settleNoteCaches, snapshotNoteCaches } from './shared';

/**
 * The three organisation-mode moves touch only their own field (the plan's "three
 * independent fields" data-model decision) — moving in Horizon mode never touches
 * priority or freeX/freeY, etc.
 */
export function useMoveNote(boardId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ noteId, input }: { noteId: string; input: NoteMoveInput }) => notesApi.move(noteId, input),
    onMutate: async ({ noteId, input }) => {
      await queryClient.cancelQueries({ queryKey: ['notes', noteId] });
      const snapshot = snapshotNoteCaches(queryClient, boardId, noteId);
      const patch =
        input.mode === 'HORIZON'
          ? { horizon: input.horizon }
          : input.mode === 'PRIORITY'
            ? { priority: input.priority }
            : { freeX: input.x, freeY: input.y };
      patchNoteCaches(queryClient, boardId, noteId, patch);
      return snapshot;
    },
    onError: (_err, { noteId }, snapshot) => {
      if (snapshot) restoreNoteCaches(queryClient, boardId, noteId, snapshot);
    },
    onSettled: (_data, _err, { noteId }) => settleNoteCaches(queryClient, boardId, noteId),
  });
}
