import { useQueryClient } from '@tanstack/react-query';
import { useSessionMutation as useMutation } from '@/lib/useSessionMutation';
import { ApiError } from '@/lib/apiClient';
import { boardsApi } from '@/lib/resources';
import { useQueryKeys } from '../queryKeys';
import { captureBoardMutation, forgetBoard, hideBoardInList, restoreBoardInList } from './shared';

/**
 * Deletes a board the caller owns (RFC-0002 §9). The confirmation dialog is the safety
 * step, so the board leaves the lists at once. A 404 means it is already gone, which the API
 * client turns into success.
 *
 * Goes through the board's mutation lane with the board revision: a deletion confirmed against
 * a board that changed meanwhile opens the existing review, like any other board write.
 */
export function useDeleteBoard(boardId: string) {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();

  return useMutation({
    mutationFn: async () => {
      // The board list carries no revision; without the board itself every delete would 409.
      try {
        await queryClient.ensureQueryData({
          queryKey: keys.board(boardId),
          queryFn: () => boardsApi.get(boardId),
        });
      } catch (error) {
        // Deleted elsewhere (or access gone) before this tab ever loaded it: already done.
        if (error instanceof ApiError && error.status === 404) return;
        throw error;
      }
      return boardsApi.remove(boardId, captureBoardMutation(queryClient, keys, boardId));
    },
    onMutate: () => ({ previous: hideBoardInList(queryClient, keys, boardId) }),
    onError: (_error, _variables, context) =>
      restoreBoardInList(queryClient, keys, boardId, context?.previous),
    onSuccess: () => forgetBoard(queryClient, keys, boardId),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: keys.meBoards(), exact: true }),
  });
}
