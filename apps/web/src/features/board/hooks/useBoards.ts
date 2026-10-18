import { useQuery } from '@tanstack/react-query';
import { boardsApi } from '@/lib/resources';
import { useQueryKeys } from './queryKeys';

/** Boards available to the caller, used by the post-login entry, board home and switcher. */
export function useBoards() {
  const keys = useQueryKeys();
  return useQuery({
    queryKey: keys.meBoards(),
    queryFn: () => boardsApi.list(),
  });
}
