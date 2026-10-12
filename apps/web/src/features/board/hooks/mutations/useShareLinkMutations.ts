import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ShareLinkDto, WhiteboardRole } from '@wally/shared';
import { shareLinkApi } from '@/lib/resources';
import { useQueryKeys } from '../queryKeys';

export function useCreateOrUpdateShareLink(boardId: string) {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();

  return useMutation({
    mutationFn: (role: WhiteboardRole) => shareLinkApi.createOrUpdate(boardId, role),
    onMutate: async (role) => {
      await queryClient.cancelQueries({ queryKey: keys.shareLink(boardId) });
      const previous = queryClient.getQueryData<ShareLinkDto>(keys.shareLink(boardId));
      if (previous)
        queryClient.setQueryData<ShareLinkDto>(keys.shareLink(boardId), { ...previous, role });
      return { previous };
    },
    onError: (_err, _role, context) => {
      if (context?.previous) queryClient.setQueryData(keys.shareLink(boardId), context.previous);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(keys.shareLink(boardId), data);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: keys.shareLink(boardId) });
    },
  });
}
