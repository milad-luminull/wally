import { isMutationPending } from '@/lib/mutationQueue';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useSessionMutation as useMutation } from '@/lib/useSessionMutation';
import type { NoteDetailDto, SubtaskDto } from '@wally/shared';
import { subtasksApi } from '@/lib/resources';
import { useQueryKeys, type QueryKeys } from '../queryKeys';
import { captureNoteMutation, cancelNoteCaches } from './shared';

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
  optimistic: NoteDetailDto | undefined,
) {
  if (!previous || !optimistic) return;
  const current = queryClient.getQueryData<NoteDetailDto>(keys.noteDetail(noteId));
  if (!current) return;
  let tasks = [...current.subtasks];
  for (const task of optimistic.subtasks) {
    const before = previous.subtasks.find((t) => t.id === task.id);
    if (!before) {
      tasks = tasks.filter((t) => t.id !== task.id);
      continue;
    }
    tasks = tasks.map((t) =>
      t.id === task.id
        ? {
            ...t,
            ...(before.done !== task.done && t.done === task.done ? { done: before.done } : {}),
            ...(before.text !== task.text && t.text === task.text ? { text: before.text } : {}),
          }
        : t,
    );
  }
  for (const task of previous.subtasks)
    if (!optimistic.subtasks.some((t) => t.id === task.id) && !tasks.some((t) => t.id === task.id))
      tasks.push(task);
  writeSubtasks(
    queryClient,
    keys,
    boardId,
    noteId,
    tasks.sort((a, b) => a.sortIndex - b.sortIndex),
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
  if (isMutationPending(`note:${noteId}`)) return;
  void queryClient.invalidateQueries({ queryKey: keys.noteDetail(noteId) });
  void queryClient.invalidateQueries({ queryKey: keys.notes(boardId) });
}

export function useAddSubtask(boardId: string) {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  return useMutation({
    mutationFn: ({ noteId, text }: { noteId: string; text: string }) =>
      subtasksApi.create(noteId, { text }, captureNoteMutation(queryClient, keys, boardId, noteId)),
    onMutate: ({ noteId, text }) => {
      cancelNoteCaches(queryClient, keys, boardId, noteId);
      const previous = snapshot(queryClient, keys, noteId);
      if (previous) {
        const now = new Date().toISOString();
        const optimistic: SubtaskDto = {
          id: `temp-${crypto.randomUUID()}`,
          noteId,
          text,
          done: false,
          sortIndex: previous.subtasks.length,
          createdAt: now,
          updatedAt: now,
        };
        writeSubtasks(queryClient, keys, boardId, noteId, [...previous.subtasks, optimistic]);
      }
      return { previous, optimistic: snapshot(queryClient, keys, noteId) };
    },
    onError: (_err, { noteId }, ctx) =>
      restore(queryClient, keys, boardId, noteId, ctx?.previous, ctx?.optimistic),
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
    }) =>
      subtasksApi.update(
        noteId,
        subtaskId,
        { done },
        captureNoteMutation(queryClient, keys, boardId, noteId),
      ),
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
      return { previous, optimistic: snapshot(queryClient, keys, noteId) };
    },
    onError: (_err, { noteId }, ctx) =>
      restore(queryClient, keys, boardId, noteId, ctx?.previous, ctx?.optimistic),
    onSettled: (_d, _e, { noteId }) => settle(queryClient, keys, boardId, noteId),
  });
}

export function useRemoveSubtask(boardId: string) {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  return useMutation({
    mutationFn: ({ noteId, subtaskId }: { noteId: string; subtaskId: string }) =>
      subtasksApi.remove(
        noteId,
        subtaskId,
        captureNoteMutation(queryClient, keys, boardId, noteId),
      ),
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
      return { previous, optimistic: snapshot(queryClient, keys, noteId) };
    },
    onError: (_err, { noteId }, ctx) =>
      restore(queryClient, keys, boardId, noteId, ctx?.previous, ctx?.optimistic),
    onSettled: (_d, _e, { noteId }) => settle(queryClient, keys, boardId, noteId),
  });
}
