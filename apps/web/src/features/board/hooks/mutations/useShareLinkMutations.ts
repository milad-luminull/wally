import { captureBoardMutation } from './shared';
import { useQueryClient } from '@tanstack/react-query';
import { useSessionMutation as useMutation } from '@/lib/useSessionMutation';
import type { ShareLinkDto, WhiteboardRole } from '@wally/shared';
import { shareLinkApi } from '@/lib/resources';
import { useQueryKeys } from '../queryKeys';

export function useCreateOrUpdateShareLink(boardId: string) {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();

  return useMutation({
    mutationFn: (role: WhiteboardRole) =>
      shareLinkApi.createOrUpdate(
        boardId,
        role,
        Boolean(queryClient.getQueryData(keys.shareLink(boardId))),
        captureBoardMutation(queryClient, keys, boardId, 'shareLink'),
      ),
    onMutate: (role) => {
      void queryClient.cancelQueries({ queryKey: keys.shareLink(boardId) });
      const previous = queryClient.getQueryData<ShareLinkDto>(keys.shareLink(boardId));
      if (previous)
        queryClient.setQueryData<ShareLinkDto>(keys.shareLink(boardId), { ...previous, role });
      return { previous };
    },
    onError: (_err, role, context) => {
      const before = context?.previous;
      if (before)
        queryClient.setQueryData<ShareLinkDto>(keys.shareLink(boardId), (current) =>
          current?.token === before.token && current.role === role
            ? { ...current, role: before.role }
            : current,
        );
    },
    onSuccess: (data) => {
      queryClient.setQueryData(keys.shareLink(boardId), data);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: keys.shareLink(boardId) });
    },
  });
}
