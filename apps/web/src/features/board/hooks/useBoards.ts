import { useQuery } from '@tanstack/react-query';
import { boardsApi } from '@/lib/resources';
import { queryKeys } from './queryKeys';

/** All boards the caller owns or is an active member of — used to resolve `/`'s redirect
 * target (owned board first, else first membership) and nothing else. */
export function useBoards() {
  return useQuery({
    queryKey: queryKeys.meBoards(),
    queryFn: () => boardsApi.list(),
  });
}
