import { captureBoardMutation } from './shared';
import { useQueryClient } from '@tanstack/react-query';
import { useSessionMutation as useMutation } from '@/lib/useSessionMutation';
import type { MemberDto, WhiteboardRole } from '@wally/shared';
import { membersApi } from '@/lib/resources';
import { useQueryKeys } from '../queryKeys';

export function useUpdateMemberRole(boardId: string) {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();

  return useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: WhiteboardRole }) =>
      membersApi.updateRole(
        boardId,
        memberId,
        { role },
        captureBoardMutation(queryClient, keys, boardId, 'members'),
      ),
    onMutate: ({ memberId, role }) => {
      void queryClient.cancelQueries({ queryKey: keys.members(boardId) });
      const previous = queryClient.getQueryData<MemberDto[]>(keys.members(boardId));
      queryClient.setQueryData<MemberDto[]>(keys.members(boardId), (prev) =>
        prev?.map((m) => (m.id === memberId ? { ...m, role } : m)),
      );
      return { previous };
    },
    onError: (_err, { memberId, role }, context) => {
      const before = context?.previous?.find((member) => member.id === memberId);
      if (before)
        queryClient.setQueryData<MemberDto[]>(keys.members(boardId), (rows) =>
          rows?.map((row) =>
            row.id === memberId && row.role === role ? { ...row, role: before.role } : row,
          ),
        );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: keys.members(boardId) });
    },
  });
}
