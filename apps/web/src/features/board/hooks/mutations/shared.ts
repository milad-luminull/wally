import type { QueryClient } from '@tanstack/react-query';
import type { NoteDetailDto, NoteDto } from '@wally/shared';
import { queryKeys } from '../queryKeys';

/**
 * Every note mutation follows the same onMutate/onError/onSettled optimistic pattern
 * (see the plan's "each behind a small dedicated hook" note) against two caches:
 *  - the board's notes LIST (['boards', boardId, 'notes'], NoteDto[]) — what WandView and
 *    ListView both render from;
 *  - that one note's DETAIL entry (['notes', noteId], NoteDetailDto), if it happens to be
 *    cached — what NoteDetailPanel renders. The list query key was in the plan's
 *    enumerated cache-key list; the per-note detail key wasn't (only board-scoped keys
 *    were), but GET /notes/:id is a real route the panel needs for subtasks[]/history[]
 *    (fields the light list DTO omits) — a minimal, documented addition, not a duplicate
 *    of the notes list.
 * This module centralises that so each hook only supplies the small bit that's actually
 * specific to it: the mutationFn and the optimistic patch function.
 */

export interface NoteCacheSnapshot {
  previousList: NoteDto[] | undefined;
  previousDetail: NoteDetailDto | undefined;
}

/**
 * Cancels outgoing refetches for BOTH caches an optimistic note patch writes, before it
 * writes them.
 *
 * Every hook here used to cancel only `['notes', noteId]`, the detail query — never the
 * board's notes LIST, which is the one the board actually renders from. React Query's
 * optimistic-update contract is that you cancel every query you are about to write, or an
 * already-in-flight refetch resolves afterwards and overwrites the optimistic data with
 * the pre-mutation server state. On the board that showed up as a dragged note snapping
 * back to its original zone for a few frames before landing again in the new one.
 *
 * Two details matter here, and getting either wrong reintroduces the flicker:
 *
 * `revert: false` — `cancelQueries` otherwise defaults to rolling each cancelled query
 * back to its pre-fetch state. That rollback lands *after* the optimistic write below it
 * and wipes it, which measured as the note jumping back to its original zone ~25ms after
 * the drop. We are about to write our own value, so there is nothing to revert to.
 *
 * Not awaited — the abort is applied synchronously, and that abort is what stops the
 * in-flight response from reaching the cache. Awaiting only waits for the cancellation to
 * settle, which resolves a macrotask later, i.e. after a paint. That delay pushed the
 * optimistic patch past the frame in which the drag overlay was torn down, leaving one
 * frame that rendered the note back at its origin.
 */
export function cancelNoteCaches(queryClient: QueryClient, boardId: string, noteId: string) {
  void queryClient.cancelQueries({ queryKey: queryKeys.notes(boardId) }, { revert: false });
  void queryClient.cancelQueries({ queryKey: ['notes', noteId] }, { revert: false });
}

export function snapshotNoteCaches(queryClient: QueryClient, boardId: string, noteId: string): NoteCacheSnapshot {
  return {
    previousList: queryClient.getQueryData<NoteDto[]>(queryKeys.notes(boardId)),
    previousDetail: queryClient.getQueryData<NoteDetailDto>(['notes', noteId]),
  };
}

export function restoreNoteCaches(queryClient: QueryClient, boardId: string, noteId: string, snap: NoteCacheSnapshot) {
  if (snap.previousList) queryClient.setQueryData(queryKeys.notes(boardId), snap.previousList);
  if (snap.previousDetail) queryClient.setQueryData(['notes', noteId], snap.previousDetail);
}

/** Applies the same partial patch to both the list entry and the detail entry (when
 * cached), so every view reflects an in-flight optimistic change identically. */
export function patchNoteCaches(
  queryClient: QueryClient,
  boardId: string,
  noteId: string,
  patch: Partial<NoteDto>,
) {
  queryClient.setQueryData<NoteDto[]>(queryKeys.notes(boardId), (prev) =>
    prev?.map((n) => (n.id === noteId ? { ...n, ...patch } : n)),
  );
  queryClient.setQueryData<NoteDetailDto>(['notes', noteId], (prev) => (prev ? { ...prev, ...patch } : prev));
}

export function settleNoteCaches(queryClient: QueryClient, boardId: string, noteId: string) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.notes(boardId) });
  void queryClient.invalidateQueries({ queryKey: ['notes', noteId] });
}
