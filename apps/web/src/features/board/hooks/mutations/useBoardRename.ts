import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { WhiteboardDto } from '@wally/shared';
import { boardsApi } from '@/lib/resources';
import { queryKeys } from '../queryKeys';

export function useBoardRename(boardId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) => boardsApi.rename(boardId, name),
    onMutate: async (name) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.board(boardId) });
      const previous = queryClient.getQueryData<WhiteboardDto>(queryKeys.board(boardId));
      if (previous)
        queryClient.setQueryData<WhiteboardDto>(queryKeys.board(boardId), { ...previous, name });
      return { previous };
    },
    onError: (_err, _name, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.board(boardId), context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.board(boardId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.meBoards() });
    },
  });
}
