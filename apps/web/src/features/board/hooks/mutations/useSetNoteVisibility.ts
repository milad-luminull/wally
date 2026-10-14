import { useQueryClient } from '@tanstack/react-query';
import type { NoteVisibility, UserSummary } from '@wally/shared';
import { useSessionMutation as useMutation } from '@/lib/useSessionMutation';
import { notesApi } from '@/lib/resources';
import { toast } from '@/lib/toast';
import {
  captureNoteMutation,
  cancelNoteCaches,
  patchNoteCaches,
  restoreNoteCaches,
  settleNoteCaches,
  snapshotNoteCaches,
} from './shared';
import { useQueryKeys } from '../queryKeys';

/** Makes a note private or shared. Making it private also makes it the creator's, on the
 *  server and here, so a failed switch rolls both fields back together. */
export function useSetNoteVisibility(boardId: string) {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();

  return useMutation({
    mutationFn: ({
      noteId,
      visibility,
    }: {
      noteId: string;
      visibility: NoteVisibility;
      creator: UserSummary | null;
    }) =>
      notesApi.update(
        noteId,
        { visibility },
        captureNoteMutation(queryClient, keys, boardId, noteId),
      ),
    onMutate: ({ noteId, visibility, creator }) => {
      cancelNoteCaches(queryClient, keys, boardId, noteId);
      const snapshot = snapshotNoteCaches(queryClient, keys, boardId, noteId);
      patchNoteCaches(
        queryClient,
        keys,
        boardId,
        noteId,
        visibility === 'PRIVATE' ? { visibility, assignee: creator } : { visibility },
      );
      return snapshot;
    },
    onSuccess: (_note, { visibility }) =>
      toast({ title: visibility === 'PRIVATE' ? 'toast.notePrivate' : 'toast.noteShared' }),
    onError: (_err, { noteId }, snapshot) => {
      if (snapshot) restoreNoteCaches(queryClient, keys, boardId, noteId, snapshot);
    },
    onSettled: (_data, _err, { noteId }) => settleNoteCaches(queryClient, keys, boardId, noteId),
  });
}
