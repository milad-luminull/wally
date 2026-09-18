import { useQuery } from '@tanstack/react-query';
import { shareLinkApi } from '@/lib/resources';
import { queryKeys } from './queryKeys';

export function useShareLink(boardId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.shareLink(boardId ?? ''),
    queryFn: () => shareLinkApi.get(boardId!),
    enabled: Boolean(boardId) && enabled,
    retry: false,
  });
}
