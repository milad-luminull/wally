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

/** No dedicated add/remove-tag route — PATCH /notes/:id's `tags` field is a full-array
 * replace (see packages/shared/src/schemas/note.ts), so both hooks read the current
 * cached tags and send the next full array. */
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
    mutationFn: ({ noteId, tag }: { noteId: string; tag: string }) => {
      const next = Array.from(new Set([...currentTags(queryClient, boardId, noteId), tag]));
      return notesApi.update(noteId, { tags: next });
    },
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
    mutationFn: ({ noteId, tag }: { noteId: string; tag: string }) => {
      const next = currentTags(queryClient, boardId, noteId).filter((t) => t !== tag);
      return notesApi.update(noteId, { tags: next });
    },
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
