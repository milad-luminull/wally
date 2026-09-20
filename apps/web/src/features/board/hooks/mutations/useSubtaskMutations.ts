import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { NoteDetailDto, SubtaskDto } from '@wally/shared';
import { subtasksApi } from '@/lib/resources';
import { queryKeys } from '../queryKeys';
import { cancelNoteCaches } from './shared';

function summaryOf(subtasks: SubtaskDto[]) {
  return { done: subtasks.filter((s) => s.done).length, total: subtasks.length };
}

function snapshot(queryClient: QueryClient, noteId: string) {
  return queryClient.getQueryData<NoteDetailDto>(['notes', noteId]);
}

function restore(queryClient: QueryClient, boardId: string, noteId: string, previous: NoteDetailDto | undefined) {
  if (!previous) return;
  queryClient.setQueryData(['notes', noteId], previous);
  queryClient.setQueryData(queryKeys.notes(boardId), (prev: NoteDetailDto[] | undefined) =>
    prev?.map((n) => (n.id === noteId ? { ...n, subtaskSummary: summaryOf(previous.subtasks) } : n)),
  );
}

function writeSubtasks(queryClient: QueryClient, boardId: string, noteId: string, subtasks: SubtaskDto[]) {
  queryClient.setQueryData<NoteDetailDto>(['notes', noteId], (prev) => (prev ? { ...prev, subtasks } : prev));
  queryClient.setQueryData(queryKeys.notes(boardId), (prev: NoteDetailDto[] | undefined) =>
    prev?.map((n) => (n.id === noteId ? { ...n, subtaskSummary: summaryOf(subtasks) } : n)),
  );
}

function settle(queryClient: QueryClient, boardId: string, noteId: string) {
  void queryClient.invalidateQueries({ queryKey: ['notes', noteId] });
  void queryClient.invalidateQueries({ queryKey: queryKeys.notes(boardId) });
}

export function useAddSubtask(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ noteId, text }: { noteId: string; text: string }) => subtasksApi.create(noteId, { text }),
    onMutate: ({ noteId, text }) => {
      cancelNoteCaches(queryClient, boardId, noteId);
      const previous = snapshot(queryClient, noteId);
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
        writeSubtasks(queryClient, boardId, noteId, [...previous.subtasks, optimistic]);
      }
      return { previous };
    },
    onError: (_err, { noteId }, ctx) => restore(queryClient, boardId, noteId, ctx?.previous),
    onSettled: (_d, _e, { noteId }) => settle(queryClient, boardId, noteId),
  });
}

export function useToggleSubtask(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ noteId, subtaskId, done }: { noteId: string; subtaskId: string; done: boolean }) =>
      subtasksApi.update(noteId, subtaskId, { done }),
    onMutate: ({ noteId, subtaskId, done }) => {
      cancelNoteCaches(queryClient, boardId, noteId);
      const previous = snapshot(queryClient, noteId);
      if (previous) {
        writeSubtasks(
          queryClient,
          boardId,
          noteId,
          previous.subtasks.map((s) => (s.id === subtaskId ? { ...s, done } : s)),
        );
      }
      return { previous };
    },
    onError: (_err, { noteId }, ctx) => restore(queryClient, boardId, noteId, ctx?.previous),
    onSettled: (_d, _e, { noteId }) => settle(queryClient, boardId, noteId),
  });
}

export function useRemoveSubtask(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ noteId, subtaskId }: { noteId: string; subtaskId: string }) => subtasksApi.remove(noteId, subtaskId),
    onMutate: ({ noteId, subtaskId }) => {
      cancelNoteCaches(queryClient, boardId, noteId);
      const previous = snapshot(queryClient, noteId);
      if (previous) {
        writeSubtasks(
          queryClient,
          boardId,
          noteId,
          previous.subtasks.filter((s) => s.id !== subtaskId),
        );
      }
      return { previous };
    },
    onError: (_err, { noteId }, ctx) => restore(queryClient, boardId, noteId, ctx?.previous),
    onSettled: (_d, _e, { noteId }) => settle(queryClient, boardId, noteId),
  });
}
