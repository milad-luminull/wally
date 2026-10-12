import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { NoteDto, NoteMoveInput } from '@wally/shared';
import { notesApi } from '@/lib/resources';
import {
  cancelNoteCaches,
  patchNoteCaches,
  restoreNoteCaches,
  settleNoteCaches,
  snapshotNoteCaches,
  type NoteCacheSnapshot,
} from './shared';
import { useQueryKeys } from '../queryKeys';

/** The cache fields each move mode owns. Exported so the board can apply the very same
 * patch live during a drag, before this mutation ever runs. */
export function noteMovePatch(input: NoteMoveInput): Partial<NoteDto> {
  if (input.mode === 'HORIZON') return { horizon: input.horizon };
  if (input.mode === 'PRIORITY') return { priority: input.priority };
  return { freeX: input.x, freeY: input.y };
}

interface MoveVariables {
  noteId: string;
  input: NoteMoveInput;
  /**
   * Cache state to roll back to if the request fails. The board passes the snapshot it
   * took when the drag *started*, because by the time this mutation runs it has already
   * moved the note optimistically — snapshotting here would capture the moved state and
   * make a rollback a no-op.
   */
  rollback?: NoteCacheSnapshot;
}

/**
 * The three organisation-mode moves touch only their own field (the plan's "three
 * independent fields" data-model decision) — moving in Horizon mode never touches
 * priority or freeX/freeY, etc.
 */
export function useMoveNote(boardId: string) {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();

  return useMutation({
    mutationFn: ({ noteId, input }: MoveVariables) => notesApi.move(noteId, input),
    onMutate: ({ noteId, input, rollback }) => {
      cancelNoteCaches(queryClient, keys, boardId, noteId);
      const snapshot = rollback ?? snapshotNoteCaches(queryClient, keys, boardId, noteId);
      // Idempotent when the board already applied this during the drag.
      patchNoteCaches(queryClient, keys, boardId, noteId, noteMovePatch(input));
      return snapshot;
    },
    onError: (_err, { noteId }, snapshot) => {
      if (snapshot) restoreNoteCaches(queryClient, keys, boardId, noteId, snapshot);
    },
    onSettled: (_data, _err, { noteId }) => settleNoteCaches(queryClient, keys, boardId, noteId),
  });
}
