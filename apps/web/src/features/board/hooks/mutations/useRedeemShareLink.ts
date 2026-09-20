import { useMutation, useQueryClient } from '@tanstack/react-query';
import { shareLinkApi } from '@/lib/resources';
import { queryKeys } from '../queryKeys';

/**
 * Redeeming a share link grants the caller a membership, so their boards list — and
 * anything cached for the board that just became reachable — is stale the moment it
 * succeeds.
 */
export function useRedeemShareLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (token: string) => shareLinkApi.redeem(token),
    onSuccess: ({ whiteboardId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.meBoards() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.board(whiteboardId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.members(whiteboardId) });
    },
  });
}
