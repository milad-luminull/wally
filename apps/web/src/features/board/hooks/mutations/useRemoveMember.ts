import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { MemberDto } from '@wally/shared';
import { membersApi } from '@/lib/resources';
import { queryKeys } from '../queryKeys';

export function useRemoveMember(boardId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (memberId: string) => membersApi.remove(boardId, memberId),
    onMutate: async (memberId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.members(boardId) });
      const previous = queryClient.getQueryData<MemberDto[]>(queryKeys.members(boardId));
      queryClient.setQueryData<MemberDto[]>(queryKeys.members(boardId), (prev) =>
        prev?.filter((m) => m.id !== memberId),
      );
      return { previous };
    },
    onError: (_err, _memberId, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.members(boardId), context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.members(boardId) });
    },
  });
}
