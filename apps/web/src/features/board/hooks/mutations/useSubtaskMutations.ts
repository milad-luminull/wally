import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { NoteDetailDto, SubtaskDto } from '@wally/shared';
import { subtasksApi } from '@/lib/resources';
import { useQueryKeys, type QueryKeys } from '../queryKeys';
import { cancelNoteCaches } from './shared';

function summaryOf(subtasks: SubtaskDto[]) {
  return { done: subtasks.filter((s) => s.done).length, total: subtasks.length };
}

function snapshot(queryClient: QueryClient, keys: QueryKeys, noteId: string) {
  return queryClient.getQueryData<NoteDetailDto>(keys.noteDetail(noteId));
}

function restore(
  queryClient: QueryClient,
  keys: QueryKeys,
  boardId: string,
  noteId: string,
  previous: NoteDetailDto | undefined,
) {
  if (!previous) return;
  queryClient.setQueryData(keys.noteDetail(noteId), previous);
  queryClient.setQueryData(keys.notes(boardId), (prev: NoteDetailDto[] | undefined) =>
    prev?.map((n) =>
      n.id === noteId ? { ...n, subtaskSummary: summaryOf(previous.subtasks) } : n,
    ),
  );
}

function writeSubtasks(
  queryClient: QueryClient,
  keys: QueryKeys,
  boardId: string,
  noteId: string,
  subtasks: SubtaskDto[],
) {
  queryClient.setQueryData<NoteDetailDto>(keys.noteDetail(noteId), (prev) =>
    prev ? { ...prev, subtasks } : prev,
  );
  queryClient.setQueryData(keys.notes(boardId), (prev: NoteDetailDto[] | undefined) =>
    prev?.map((n) => (n.id === noteId ? { ...n, subtaskSummary: summaryOf(subtasks) } : n)),
  );
}

function settle(queryClient: QueryClient, keys: QueryKeys, boardId: string, noteId: string) {
  void queryClient.invalidateQueries({ queryKey: keys.noteDetail(noteId) });
  void queryClient.invalidateQueries({ queryKey: keys.notes(boardId) });
}

export function useAddSubtask(boardId: string) {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  return useMutation({
    mutationFn: ({ noteId, text }: { noteId: string; text: string }) =>
      subtasksApi.create(noteId, { text }),
    onMutate: ({ noteId, text }) => {
      cancelNoteCaches(queryClient, keys, boardId, noteId);
      const previous = snapshot(queryClient, keys, noteId);
      if (previous) {
        const now = new Date().toISOString();
        const optimistic: SubtaskDto = {
          id: `temp-${Date.now()}`,
          noteId,
          text,
          done: false,
          sortIndex: previous.subtasks.length,
          createdAt: now,
          updatedAt: now,
        };
        writeSubtasks(queryClient, keys, boardId, noteId, [...previous.subtasks, optimistic]);
      }
      return { previous };
    },
    onError: (_err, { noteId }, ctx) => restore(queryClient, keys, boardId, noteId, ctx?.previous),
    onSettled: (_d, _e, { noteId }) => settle(queryClient, keys, boardId, noteId),
  });
}

export function useToggleSubtask(boardId: string) {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  return useMutation({
    mutationFn: ({
      noteId,
      subtaskId,
      done,
    }: {
      noteId: string;
      subtaskId: string;
      done: boolean;
    }) => subtasksApi.update(noteId, subtaskId, { done }),
    onMutate: ({ noteId, subtaskId, done }) => {
      cancelNoteCaches(queryClient, keys, boardId, noteId);
      const previous = snapshot(queryClient, keys, noteId);
      if (previous) {
        writeSubtasks(
          queryClient,
          keys,
          boardId,
          noteId,
          previous.subtasks.map((s) => (s.id === subtaskId ? { ...s, done } : s)),
        );
      }
      return { previous };
    },
    onError: (_err, { noteId }, ctx) => restore(queryClient, keys, boardId, noteId, ctx?.previous),
    onSettled: (_d, _e, { noteId }) => settle(queryClient, keys, boardId, noteId),
  });
}

export function useRemoveSubtask(boardId: string) {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  return useMutation({
    mutationFn: ({ noteId, subtaskId }: { noteId: string; subtaskId: string }) =>
      subtasksApi.remove(noteId, subtaskId),
    onMutate: ({ noteId, subtaskId }) => {
      cancelNoteCaches(queryClient, keys, boardId, noteId);
      const previous = snapshot(queryClient, keys, noteId);
      if (previous) {
        writeSubtasks(
          queryClient,
          keys,
          boardId,
          noteId,
          previous.subtasks.filter((s) => s.id !== subtaskId),
        );
      }
      return { previous };
    },
    onError: (_err, { noteId }, ctx) => restore(queryClient, keys, boardId, noteId, ctx?.previous),
    onSettled: (_d, _e, { noteId }) => settle(queryClient, keys, boardId, noteId),
  });
}
