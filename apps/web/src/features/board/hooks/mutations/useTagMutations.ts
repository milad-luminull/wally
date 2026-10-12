import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { NoteDto } from '@wally/shared';
import { notesApi } from '@/lib/resources';
import { queryKeys } from '../queryKeys';
import {
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
  boardId: string,
  noteId: string,
): string[] {
  const list = queryClient.getQueryData<NoteDto[]>(queryKeys.notes(boardId));
  return list?.find((n) => n.id === noteId)?.tags ?? [];
}

export function useAddTag(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ noteId, tag }: { noteId: string; tag: string }) =>
      notesApi.update(noteId, { tagChanges: { add: [tag] } }),
    onMutate: ({ noteId, tag }) => {
      cancelNoteCaches(queryClient, boardId, noteId);
      const snapshot = snapshotNoteCaches(queryClient, boardId, noteId);
      const next = Array.from(new Set([...currentTags(queryClient, boardId, noteId), tag]));
      patchNoteCaches(queryClient, boardId, noteId, { tags: next });
      return snapshot;
    },
    onError: (_err, { noteId }, snapshot) => {
      if (snapshot) restoreNoteCaches(queryClient, boardId, noteId, snapshot);
    },
    onSettled: (_d, _e, { noteId }) => settleNoteCaches(queryClient, boardId, noteId),
  });
}

export function useRemoveTag(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ noteId, tag }: { noteId: string; tag: string }) =>
      notesApi.update(noteId, { tagChanges: { remove: [tag] } }),
    onMutate: ({ noteId, tag }) => {
      cancelNoteCaches(queryClient, boardId, noteId);
      const snapshot = snapshotNoteCaches(queryClient, boardId, noteId);
      const next = currentTags(queryClient, boardId, noteId).filter((t) => t !== tag);
      patchNoteCaches(queryClient, boardId, noteId, { tags: next });
      return snapshot;
    },
    onError: (_err, { noteId }, snapshot) => {
      if (snapshot) restoreNoteCaches(queryClient, boardId, noteId, snapshot);
    },
    onSettled: (_d, _e, { noteId }) => settleNoteCaches(queryClient, boardId, noteId),
  });
}
