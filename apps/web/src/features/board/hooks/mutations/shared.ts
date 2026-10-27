import type { QueryClient } from '@tanstack/react-query';
import type { NoteDetailDto, NoteDto, WhiteboardSummaryDto } from '@wally/shared';
import { captureMutation, isMutationPending } from '@/lib/mutationQueue';
import type { QueryKeys } from '../queryKeys';

export interface NoteCacheSnapshot {
  previousList: NoteDto[] | undefined;
  previousDetail: NoteDetailDto | undefined;
  optimistic: Partial<NoteDto>;
}
const snapshots = new WeakMap<QueryClient, Map<string, NoteCacheSnapshot>>();
const snapshotKey = (keys: QueryKeys, boardId: string, noteId: string) =>
  JSON.stringify([keys.notes(boardId), noteId]);

export function cancelNoteCaches(
  queryClient: QueryClient,
  keys: QueryKeys,
  boardId: string,
  noteId: string,
) {
  void queryClient.cancelQueries({ queryKey: keys.notes(boardId) }, { revert: false });
  void queryClient.cancelQueries({ queryKey: keys.noteDetail(noteId) }, { revert: false });
}
export function snapshotNoteCaches(
  queryClient: QueryClient,
  keys: QueryKeys,
  boardId: string,
  noteId: string,
): NoteCacheSnapshot {
  const snapshot = {
    previousList: queryClient.getQueryData<NoteDto[]>(keys.notes(boardId)),
    previousDetail: queryClient.getQueryData<NoteDetailDto>(keys.noteDetail(noteId)),
    optimistic: {},
  };
  let entries = snapshots.get(queryClient);
  if (!entries) {
    entries = new Map();
    snapshots.set(queryClient, entries);
  }
  entries.set(snapshotKey(keys, boardId, noteId), snapshot);
  return snapshot;
}
/** Revert only fields this operation still owns; never restore an entire list. */
export function restoreNoteCaches(
  queryClient: QueryClient,
  keys: QueryKeys,
  boardId: string,
  noteId: string,
  snapshot: NoteCacheSnapshot,
) {
  const previous =
    snapshot.previousDetail ?? snapshot.previousList?.find((note) => note.id === noteId);
  if (!previous) return;
  const restore = <T extends NoteDto>(current: T): T => {
    const patch: Partial<NoteDto> = {};
    for (const field of Object.keys(snapshot.optimistic) as (keyof NoteDto)[]) {
      if (JSON.stringify(current[field]) === JSON.stringify(snapshot.optimistic[field]))
        Object.assign(patch, { [field]: previous[field] });
    }
    return { ...current, ...patch };
  };
  queryClient.setQueryData<NoteDto[]>(keys.notes(boardId), (list) =>
    list?.map((note) => (note.id === noteId ? restore(note) : note)),
  );
  queryClient.setQueryData<NoteDetailDto>(keys.noteDetail(noteId), (note) =>
    note ? restore(note) : note,
  );
}
export function patchNoteCaches(
  queryClient: QueryClient,
  keys: QueryKeys,
  boardId: string,
  noteId: string,
  patch: Partial<NoteDto>,
) {
  const snapshot = snapshots.get(queryClient)?.get(snapshotKey(keys, boardId, noteId));
  if (snapshot) Object.assign(snapshot.optimistic, patch);
  queryClient.setQueryData<NoteDto[]>(keys.notes(boardId), (list) =>
    list?.map((note) => (note.id === noteId ? { ...note, ...patch } : note)),
  );
  queryClient.setQueryData<NoteDetailDto>(keys.noteDetail(noteId), (note) =>
    note ? { ...note, ...patch } : note,
  );
}
export function settleNoteCaches(
  queryClient: QueryClient,
  keys: QueryKeys,
  boardId: string,
  noteId: string,
) {
  if (isMutationPending(`note:${noteId}`)) return;
  void queryClient.invalidateQueries({ queryKey: keys.notes(boardId) });
  void queryClient.invalidateQueries({ queryKey: keys.noteDetail(noteId) });
}
/** Capture the version actually displayed, including the start of a drag. */
export function captureNoteMutation(
  queryClient: QueryClient,
  keys: QueryKeys,
  boardId: string,
  noteId: string,
  snapshot?: NoteCacheSnapshot,
) {
  const note = snapshot
    ? (snapshot.previousDetail ?? snapshot.previousList?.find((note) => note.id === noteId))
    : (queryClient.getQueryData<NoteDetailDto>(keys.noteDetail(noteId)) ??
      queryClient.getQueryData<NoteDto[]>(keys.notes(boardId))?.find((note) => note.id === noteId));
  return captureMutation(`note:${noteId}`, { revision: note?.revision ?? 0 });
}
export function captureBoardMutation(
  queryClient: QueryClient,
  keys: QueryKeys,
  boardId: string,
  kind: 'members' | 'shareLink' | 'board' = 'board',
) {
  const snapshot = queryClient.getQueryData(keys[kind](boardId));
  const datum = (Array.isArray(snapshot) ? snapshot[0] : snapshot) as
    { boardRevision?: number; revision?: number } | undefined;
  const board = queryClient.getQueryData<{ revision: number }>(keys.board(boardId));
  return captureMutation(`board:${boardId}`, {
    revision: datum?.boardRevision ?? datum?.revision ?? board?.revision ?? 0,
  });
}

/**
 * Takes a board out of the board list at once and returns the list as it was, for a rollback.
 * Used when the caller deletes or leaves a board (RFC 0002 §9, §10).
 */
export function hideBoardInList(queryClient: QueryClient, keys: QueryKeys, boardId: string) {
  void queryClient.cancelQueries({ queryKey: keys.meBoards() });
  const previous = queryClient.getQueryData<WhiteboardSummaryDto[]>(keys.meBoards());
  queryClient.setQueryData<WhiteboardSummaryDto[]>(keys.meBoards(), (list) =>
    list?.filter((board) => board.id !== boardId),
  );
  return previous;
}

/** Puts a hidden board back where it was, unless a refetch has already settled the list. */
export function restoreBoardInList(
  queryClient: QueryClient,
  keys: QueryKeys,
  boardId: string,
  previous: WhiteboardSummaryDto[] | undefined,
) {
  const board = previous?.find((item) => item.id === boardId);
  if (!board) return;
  queryClient.setQueryData<WhiteboardSummaryDto[]>(keys.meBoards(), (list) => {
    if (!list || list.some((item) => item.id === boardId)) return list;
    const next = [...list];
    next.splice(Math.min(previous!.indexOf(board), next.length), 0, board);
    return next;
  });
}

/** Drops every cache under a board that is gone: the board, its notes, members, invites, link. */
export function forgetBoard(queryClient: QueryClient, keys: QueryKeys, boardId: string) {
  queryClient.removeQueries({ queryKey: keys.board(boardId) });
}
