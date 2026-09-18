import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { MemberDto, WhiteboardRole } from '@wally/shared';
import { membersApi } from '@/lib/resources';
import { queryKeys } from '../queryKeys';

export function useUpdateMemberRole(boardId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: WhiteboardRole }) =>
      membersApi.updateRole(boardId, memberId, { role }),
    onMutate: async ({ memberId, role }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.members(boardId) });
      const previous = queryClient.getQueryData<MemberDto[]>(queryKeys.members(boardId));
      queryClient.setQueryData<MemberDto[]>(queryKeys.members(boardId), (prev) =>
        prev?.map((m) => (m.id === memberId ? { ...m, role } : m)),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.members(boardId), context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.members(boardId) });
    },
  });
}
