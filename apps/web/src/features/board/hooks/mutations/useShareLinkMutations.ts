import { captureBoardMutation } from './shared';
import { useQueryClient } from '@tanstack/react-query';
import { useSessionMutation as useMutation } from '@/lib/useSessionMutation';
import type { ShareLinkDto } from '@wally/shared';
import { shareLinkApi, type ShareLinkChange } from '@/lib/resources';
import { useQueryKeys } from '../queryKeys';

export function useCreateOrUpdateShareLink(boardId: string) {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();

  return useMutation({
    meta: { silentError: true },
    mutationFn: (change: ShareLinkChange) =>
      shareLinkApi.createOrUpdate(
        boardId,
        change,
        Boolean(queryClient.getQueryData(keys.shareLink(boardId))),
        captureBoardMutation(queryClient, keys, boardId, 'shareLink'),
      ),
    // Only a role change is shown before the server answers; a new expiry date comes back
    // from the server.
    onMutate: ({ role }) => {
      void queryClient.cancelQueries({ queryKey: keys.shareLink(boardId) });
      const previous = queryClient.getQueryData<ShareLinkDto>(keys.shareLink(boardId));
      if (previous && role)
        queryClient.setQueryData<ShareLinkDto>(keys.shareLink(boardId), { ...previous, role });
      return { previous };
    },
    onError: (_err, { role }, context) => {
      const before = context?.previous;
      if (before && role)
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

export function useChangeShareLink(boardId: string) {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  return useMutation({
    meta: { silentError: true },
    mutationFn: async (action: 'disable' | 'rotate') => {
      if (action === 'rotate') return shareLinkApi.rotate(boardId);
      await shareLinkApi.remove(boardId);
      return null;
    },
    onMutate: () => {
      void queryClient.cancelQueries({ queryKey: keys.shareLink(boardId) });
    },
    onSuccess: (link) => {
      queryClient.setQueryData(keys.shareLink(boardId), link);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: keys.shareLink(boardId) });
    },
  });
}
