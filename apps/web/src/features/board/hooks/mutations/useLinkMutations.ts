import { useQueryClient } from '@tanstack/react-query';
import { useSessionMutation as useMutation } from '@/lib/useSessionMutation';
import type { NoteDto } from '@wally/shared';
import { notesApi } from '@/lib/resources';
import { useQueryKeys, type QueryKeys } from '../queryKeys';
import {
  captureNoteMutation,
  cancelNoteCaches,
  patchNoteCaches,
  restoreNoteCaches,
  settleNoteCaches,
  snapshotNoteCaches,
} from './shared';

/** The request carries only the targetId being added or removed (`linkChanges`), which the API
 * applies to the note's stored links — sending the whole cached array would drop a targetId a
 * colleague added meanwhile. The cached links are used only for the optimistic patch. See
 * packages/shared/src/schemas/note.ts. */
function currentLinks(
  queryClient: ReturnType<typeof useQueryClient>,
  keys: QueryKeys,
  boardId: string,
  noteId: string,
): string[] {
  const list = queryClient.getQueryData<NoteDto[]>(keys.notes(boardId));
  return list?.find((n) => n.id === noteId)?.links ?? [];
}

export function useAddLink(boardId: string) {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  return useMutation({
    mutationFn: ({ noteId, targetId }: { noteId: string; targetId: string }) =>
      notesApi.update(
        noteId,
        { linkChanges: { add: [targetId] } },
        captureNoteMutation(queryClient, keys, boardId, noteId),
      ),
    onMutate: ({ noteId, targetId }) => {
      cancelNoteCaches(queryClient, keys, boardId, noteId);
      const snapshot = snapshotNoteCaches(queryClient, keys, boardId, noteId);
      const next = Array.from(
        new Set([...currentLinks(queryClient, keys, boardId, noteId), targetId]),
      );
      patchNoteCaches(queryClient, keys, boardId, noteId, { links: next });
      return snapshot;
    },
    onError: (_err, { noteId }, snapshot) => {
      if (snapshot) restoreNoteCaches(queryClient, keys, boardId, noteId, snapshot);
    },
    onSettled: (_d, _e, { noteId }) => settleNoteCaches(queryClient, keys, boardId, noteId),
  });
}

export function useRemoveLink(boardId: string) {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  return useMutation({
    mutationFn: ({ noteId, targetId }: { noteId: string; targetId: string }) =>
      notesApi.update(
        noteId,
        { linkChanges: { remove: [targetId] } },
        captureNoteMutation(queryClient, keys, boardId, noteId),
      ),
    onMutate: ({ noteId, targetId }) => {
      cancelNoteCaches(queryClient, keys, boardId, noteId);
      const snapshot = snapshotNoteCaches(queryClient, keys, boardId, noteId);
      const next = currentLinks(queryClient, keys, boardId, noteId).filter((t) => t !== targetId);
      patchNoteCaches(queryClient, keys, boardId, noteId, { links: next });
      return snapshot;
    },
    onError: (_err, { noteId }, snapshot) => {
      if (snapshot) restoreNoteCaches(queryClient, keys, boardId, noteId, snapshot);
    },
    onSettled: (_d, _e, { noteId }) => settleNoteCaches(queryClient, keys, boardId, noteId),
  });
}
