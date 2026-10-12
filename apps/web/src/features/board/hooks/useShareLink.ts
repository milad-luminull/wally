import { useQuery } from '@tanstack/react-query';
import { shareLinkApi } from '@/lib/resources';
import { useQueryKeys } from './queryKeys';

export function useShareLink(boardId: string | undefined, enabled: boolean) {
  const keys = useQueryKeys();
  return useQuery({
    queryKey: keys.shareLink(boardId ?? ''),
    queryFn: () => shareLinkApi.get(boardId!),
    enabled: Boolean(boardId) && enabled,
    retry: false,
  });
}
