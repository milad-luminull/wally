import { useQuery } from '@tanstack/react-query';
import { boardsApi } from '@/lib/resources';
import { queryKeys } from './queryKeys';

/** All boards the caller owns or is an active member of — resolves `/`'s redirect target
 * (owned board first, else first membership) and backs the BoardSwitcher, which is the only
 * route to a board you do not own. */
export function useBoards() {
  return useQuery({
    queryKey: queryKeys.meBoards(),
    queryFn: () => boardsApi.list(),
  });
}
