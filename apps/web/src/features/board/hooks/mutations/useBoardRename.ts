import { useQueryClient } from '@tanstack/react-query';
import { useSessionMutation as useMutation } from '@/lib/useSessionMutation';
import type { WhiteboardDto } from '@wally/shared';
import type { MutationTicket } from '@/lib/mutationQueue';
import { boardsApi } from '@/lib/resources';
import { useQueryKeys } from '../queryKeys';

export function useBoardRename(boardId: string) {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();

  return useMutation({
    mutationFn: ({ name, ticket }: { name: string; ticket: MutationTicket }) =>
      boardsApi.rename(boardId, name, ticket),
    onMutate: ({ name }) => {
      void queryClient.cancelQueries({ queryKey: keys.board(boardId) });
      const previous = queryClient.getQueryData<WhiteboardDto>(keys.board(boardId));
      if (previous)
        queryClient.setQueryData<WhiteboardDto>(keys.board(boardId), { ...previous, name });
      return { previous };
    },
    onError: (_err, { name }, context) => {
      const before = context?.previous;
      if (before)
        queryClient.setQueryData<WhiteboardDto>(keys.board(boardId), (current) =>
          current?.name === name ? { ...current, name: before.name } : current,
        );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: keys.board(boardId) });
      void queryClient.invalidateQueries({ queryKey: keys.meBoards() });
    },
  });
}
