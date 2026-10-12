import { useQuery } from '@tanstack/react-query';
import { boardsApi } from '@/lib/resources';
import { useQueryKeys } from './queryKeys';

export function useBoard(boardId: string | undefined) {
  const keys = useQueryKeys();
  return useQuery({
    queryKey: keys.board(boardId ?? ''),
    queryFn: () => boardsApi.get(boardId!),
    enabled: Boolean(boardId),
  });
}
