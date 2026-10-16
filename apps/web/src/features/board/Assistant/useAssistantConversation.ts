import { useQuery } from '@tanstack/react-query';
import type { AssistantConversationDto } from '@wally/shared';
import { ApiError } from '@/lib/apiClient';
import { assistantApi } from '@/lib/resources';
import { useQueryKeys } from '../hooks/queryKeys';

/** The latest open conversation on this board, or null when there is none yet. */
export function useAssistantConversation(boardId: string, enabled: boolean) {
  const keys = useQueryKeys();
  return useQuery<AssistantConversationDto | null>({
    queryKey: keys.assistantLatest(boardId),
    queryFn: async () => {
      try {
        return await assistantApi.latest(boardId);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    enabled,
  });
}
