import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ShareLinkDto, WhiteboardRole } from '@wally/shared';
import { shareLinkApi } from '@/lib/resources';
import { queryKeys } from '../queryKeys';

export function useCreateOrUpdateShareLink(boardId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (role: WhiteboardRole) => shareLinkApi.createOrUpdate(boardId, role),
    onMutate: async (role) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.shareLink(boardId) });
      const previous = queryClient.getQueryData<ShareLinkDto>(queryKeys.shareLink(boardId));
      if (previous)
        queryClient.setQueryData<ShareLinkDto>(queryKeys.shareLink(boardId), { ...previous, role });
      return { previous };
    },
    onError: (_err, _role, context) => {
      if (context?.previous)
        queryClient.setQueryData(queryKeys.shareLink(boardId), context.previous);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.shareLink(boardId), data);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.shareLink(boardId) });
    },
  });
}
