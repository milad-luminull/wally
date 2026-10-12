import { useQueryClient } from '@tanstack/react-query';
import { useSessionMutation as useMutation } from '@/lib/useSessionMutation';
import { shareLinkApi } from '@/lib/resources';
import { useQueryKeys } from '../queryKeys';

/**
 * Redeeming a share link grants the caller a membership, so their boards list — and
 * anything cached for the board that just became reachable — is stale the moment it
 * succeeds.
 */
export function useRedeemShareLink() {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();

  return useMutation({
    mutationFn: (token: string) => shareLinkApi.redeem(token),
    // ShareRedeemPage renders its own failure states.
    meta: { silentError: true },
    onSuccess: ({ whiteboardId }) => {
      void queryClient.invalidateQueries({ queryKey: keys.meBoards() });
      void queryClient.invalidateQueries({ queryKey: keys.board(whiteboardId) });
      void queryClient.invalidateQueries({ queryKey: keys.members(whiteboardId) });
    },
  });
}
