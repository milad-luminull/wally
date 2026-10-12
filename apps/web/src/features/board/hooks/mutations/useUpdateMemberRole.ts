import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { MemberDto, WhiteboardRole } from '@wally/shared';
import { membersApi } from '@/lib/resources';
import { useQueryKeys } from '../queryKeys';

export function useUpdateMemberRole(boardId: string) {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();

  return useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: WhiteboardRole }) =>
      membersApi.updateRole(boardId, memberId, { role }),
    onMutate: async ({ memberId, role }) => {
      await queryClient.cancelQueries({ queryKey: keys.members(boardId) });
      const previous = queryClient.getQueryData<MemberDto[]>(keys.members(boardId));
      queryClient.setQueryData<MemberDto[]>(keys.members(boardId), (prev) =>
        prev?.map((m) => (m.id === memberId ? { ...m, role } : m)),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(keys.members(boardId), context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: keys.members(boardId) });
    },
  });
}
