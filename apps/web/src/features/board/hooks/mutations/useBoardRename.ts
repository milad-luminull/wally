import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { WhiteboardDto } from '@wally/shared';
import { boardsApi } from '@/lib/resources';
import { useQueryKeys } from '../queryKeys';

export function useBoardRename(boardId: string) {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();

  return useMutation({
    mutationFn: (name: string) => boardsApi.rename(boardId, name),
    onMutate: async (name) => {
      await queryClient.cancelQueries({ queryKey: keys.board(boardId) });
      const previous = queryClient.getQueryData<WhiteboardDto>(keys.board(boardId));
      if (previous)
        queryClient.setQueryData<WhiteboardDto>(keys.board(boardId), { ...previous, name });
      return { previous };
    },
    onError: (_err, _name, context) => {
      if (context?.previous) queryClient.setQueryData(keys.board(boardId), context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: keys.board(boardId) });
      void queryClient.invalidateQueries({ queryKey: keys.meBoards() });
    },
  });
}
