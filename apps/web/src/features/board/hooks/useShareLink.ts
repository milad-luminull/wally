import { useQuery } from '@tanstack/react-query';
import { shareLinkApi } from '@/lib/resources';
import { useQueryKeys } from './queryKeys';

export function useShareLink(boardId: string | undefined, enabled: boolean) {
  const keys = useQueryKeys();
  return useQuery({
    queryKey: keys.shareLink(boardId ?? ''),
    queryFn: async () => {
      try {
        return await shareLinkApi.get(boardId!);
      } catch (error) {
        if ((error as { status?: number }).status === 404) return null;
        throw error;
      }
    },
    enabled: Boolean(boardId) && enabled,
    retry: false,
  });
}
