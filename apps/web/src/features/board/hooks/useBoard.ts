import { useQuery } from '@tanstack/react-query';
import { boardsApi } from '@/lib/resources';
import { queryKeys } from './queryKeys';

export function useBoard(boardId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.board(boardId ?? ''),
    queryFn: () => boardsApi.get(boardId!),
    enabled: Boolean(boardId),
  });
}
