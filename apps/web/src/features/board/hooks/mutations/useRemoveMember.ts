import { captureBoardMutation } from './shared';
import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSessionMutation as useMutation } from '@/lib/useSessionMutation';
import type { MemberDto } from '@wally/shared';
import { isCurrentSession, type MutationTicket } from '@/lib/mutationQueue';
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
    mutationFn: ({ memberId, ticket }: { memberId: string; ticket: MutationTicket }) =>
      membersApi.remove(boardId, memberId, ticket),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: membersKey }),
  });
  const { mutate } = mutation;

  const removeMember = useCallback(
    (member: MemberDto) => {
      const ticket = {
        ...captureBoardMutation(queryClient, keys, boardId, 'members'),
        pinned: true,
      };
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
        onExpire: () => {
          if (isCurrentSession(ticket.generation)) mutate({ memberId: member.id, ticket });
        },
      });
    },
    [boardId, keys, membersKey, mutate, queryClient],
  );

  return { removeMember };
}
