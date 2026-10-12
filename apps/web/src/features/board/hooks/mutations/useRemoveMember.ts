import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { MemberDto } from '@wally/shared';
import { membersApi } from '@/lib/resources';
import { toast } from '@/lib/toast';
import { useQueryKeys } from '../queryKeys';

/**
 * Removes a member with an undo window — same shape as useDeleteNote: the row goes at once,
 * the request goes when the toast expires, and Undo is a cache restore.
 */
export function useRemoveMember(boardId: string) {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  const membersKey = keys.members(boardId);

  const mutation = useMutation({
    mutationFn: (memberId: string) => membersApi.remove(boardId, memberId),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: membersKey }),
  });
  const { mutate } = mutation;

  const removeMember = useCallback(
    (member: MemberDto) => {
      void queryClient.cancelQueries({ queryKey: membersKey });
      const previous = queryClient.getQueryData<MemberDto[]>(membersKey);
      const index = previous?.findIndex((m) => m.id === member.id) ?? -1;
      queryClient.setQueryData<MemberDto[]>(membersKey, (prev) =>
        prev?.filter((m) => m.id !== member.id),
      );

      toast({
        title: 'toast.memberRemoved',
        values: { name: member.displayName ?? member.email },
        action: {
          label: 'toast.undo',
          onClick: () =>
            queryClient.setQueryData<MemberDto[]>(membersKey, (prev) => {
              if (!prev || prev.some((m) => m.id === member.id)) return prev;
              const next = [...prev];
              next.splice(index < 0 ? next.length : index, 0, member);
              return next;
            }),
        },
        onExpire: () => mutate(member.id),
      });
    },
    [membersKey, mutate, queryClient],
  );

  return { removeMember };
}
