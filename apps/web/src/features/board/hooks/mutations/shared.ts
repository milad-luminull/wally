import type { QueryClient } from '@tanstack/react-query';
import type { NoteDetailDto, NoteDto } from '@wally/shared';
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
