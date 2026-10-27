import { useQueryClient } from '@tanstack/react-query';
import { useSessionMutation as useMutation } from '@/lib/useSessionMutation';
import { boardsApi } from '@/lib/resources';
import { useQueryKeys } from '../queryKeys';
import { forgetBoard, hideBoardInList, restoreBoardInList } from './shared';

/**
 * Leaves a board the caller was invited to (RFC 0002 §10). No revision: leaving states a
 * fact about the caller. A 404 means the membership is already gone, which the API client
 * turns into success, so the row simply disappears.
 */
export function useLeaveBoard(boardId: string) {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();

  return useMutation({
    mutationFn: () => boardsApi.leave(boardId),
    onMutate: () => ({ previous: hideBoardInList(queryClient, keys, boardId) }),
    onError: (_error, _variables, context) =>
      restoreBoardInList(queryClient, keys, boardId, context?.previous),
    onSuccess: () => forgetBoard(queryClient, keys, boardId),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: keys.meBoards(), exact: true }),
  });
}
