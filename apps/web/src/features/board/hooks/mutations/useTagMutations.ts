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

/** The request carries only the tag being added or removed (`tagChanges`), which the API
 * applies to the note's stored tags — sending the whole cached array would drop a tag a
 * colleague added meanwhile. The cached tags are used only for the optimistic patch. See
 * packages/shared/src/schemas/note.ts. */
function currentTags(
  queryClient: ReturnType<typeof useQueryClient>,
  keys: QueryKeys,
  boardId: string,
  noteId: string,
): string[] {
  const list = queryClient.getQueryData<NoteDto[]>(keys.notes(boardId));
  return list?.find((n) => n.id === noteId)?.tags ?? [];
}

export function useAddTag(boardId: string) {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  return useMutation({
    mutationFn: ({ noteId, tag }: { noteId: string; tag: string }) =>
      notesApi.update(
        noteId,
        { tagChanges: { add: [tag] } },
        captureNoteMutation(queryClient, keys, boardId, noteId),
      ),
    onMutate: ({ noteId, tag }) => {
      cancelNoteCaches(queryClient, keys, boardId, noteId);
      const snapshot = snapshotNoteCaches(queryClient, keys, boardId, noteId);
      const next = Array.from(new Set([...currentTags(queryClient, keys, boardId, noteId), tag]));
      patchNoteCaches(queryClient, keys, boardId, noteId, { tags: next });
      return snapshot;
    },
    onError: (_err, { noteId }, snapshot) => {
      if (snapshot) restoreNoteCaches(queryClient, keys, boardId, noteId, snapshot);
    },
    onSettled: (_d, _e, { noteId }) => settleNoteCaches(queryClient, keys, boardId, noteId),
  });
}

export function useRemoveTag(boardId: string) {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  return useMutation({
    mutationFn: ({ noteId, tag }: { noteId: string; tag: string }) =>
      notesApi.update(
        noteId,
        { tagChanges: { remove: [tag] } },
        captureNoteMutation(queryClient, keys, boardId, noteId),
      ),
    onMutate: ({ noteId, tag }) => {
      cancelNoteCaches(queryClient, keys, boardId, noteId);
      const snapshot = snapshotNoteCaches(queryClient, keys, boardId, noteId);
      const next = currentTags(queryClient, keys, boardId, noteId).filter((t) => t !== tag);
      patchNoteCaches(queryClient, keys, boardId, noteId, { tags: next });
      return snapshot;
    },
    onError: (_err, { noteId }, snapshot) => {
      if (snapshot) restoreNoteCaches(queryClient, keys, boardId, noteId, snapshot);
    },
    onSettled: (_d, _e, { noteId }) => settleNoteCaches(queryClient, keys, boardId, noteId),
  });
}
