import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { InviteCreateInput, MemberDto } from '@wally/shared';
import { membersApi } from '@/lib/resources';
import { useQueryKeys } from '../queryKeys';

/** Optimistically adds a PENDING row to the members list the moment the form submits —
 * see InviteByEmailForm, which shows it immediately rather than waiting on the round trip. */
export function useCreateInvite(boardId: string) {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();

  return useMutation({
    mutationFn: (input: InviteCreateInput) => membersApi.invite(boardId, input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: keys.members(boardId) });
      const previous = queryClient.getQueryData<MemberDto[]>(keys.members(boardId));
      const tempId = `temp-${Date.now()}`;
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
      if (context?.previous) queryClient.setQueryData(keys.members(boardId), context.previous);
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
