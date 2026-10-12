import { useQuery } from '@tanstack/react-query';
import { boardsApi } from '@/lib/resources';
import { useQueryKeys } from './queryKeys';

/** All boards the caller owns or is an active member of — resolves `/`'s redirect target
 * (owned board first, else first membership) and backs the BoardSwitcher, which is the only
 * route to a board you do not own. */
export function useBoards() {
  const keys = useQueryKeys();
  return useQuery({
    queryKey: keys.meBoards(),
    queryFn: () => boardsApi.list(),
  });
}
