import { captureBoardMutation } from './shared';
import { useQueryClient } from '@tanstack/react-query';
import { useSessionMutation as useMutation } from '@/lib/useSessionMutation';
import type { InviteCreateInput, MemberDto } from '@wally/shared';
import { membersApi } from '@/lib/resources';
import { useQueryKeys } from '../queryKeys';

/** Optimistically adds a PENDING row to the members list the moment the form submits —
 * see InviteByEmailForm, which shows it immediately rather than waiting on the round trip. */
export function useCreateInvite(boardId: string) {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();

  return useMutation({
    // The form says a failed invite under its field: no second message from the global toast.
    meta: { silentError: true },
    mutationFn: (input: InviteCreateInput) =>
      membersApi.invite(
        boardId,
        input,
        captureBoardMutation(queryClient, keys, boardId, 'members'),
      ),
    onMutate: (input) => {
      void queryClient.cancelQueries({ queryKey: keys.members(boardId) });
      const previous = queryClient.getQueryData<MemberDto[]>(keys.members(boardId));
      const tempId = `temp-${crypto.randomUUID()}`;
      const optimistic: MemberDto = {
        id: tempId,
        userId: null,
        email: input.email,
        displayName: null,
        role: input.role,
        status: 'PENDING',
      };
      queryClient.setQueryData<MemberDto[]>(keys.members(boardId), (prev) => [
        ...(prev ?? []),
        optimistic,
      ]);
      return { previous, tempId };
    },
    onError: (_err, _input, context) => {
      if (context)
        queryClient.setQueryData<MemberDto[]>(keys.members(boardId), (rows) =>
          rows?.filter((row) => row.id !== context.tempId),
        );
    },
    onSuccess: (created, _input, context) => {
      queryClient.setQueryData<MemberDto[]>(keys.members(boardId), (prev) =>
        prev?.map((m) => (m.id === context?.tempId ? created : m)),
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: keys.members(boardId) });
    },
  });
}
