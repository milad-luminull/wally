import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { NoteCreateInput, NoteDto } from '@wally/shared';
import { notesApi } from '@/lib/resources';
import { useQueryKeys } from '../queryKeys';

const TEMP_ID_PREFIX = 'temp-';

function optimisticNote(boardId: string, tempId: string, input: Partial<NoteCreateInput>): NoteDto {
  const now = new Date().toISOString();
  return {
    id: tempId,
    whiteboardId: boardId,
    title: input.title ?? '',
    description: input.description ?? '',
    status: 'OPEN',
    completedAt: null,
    priority: input.priority ?? 'MITTEL',
    horizon: input.horizon ?? 'HEUTE',
    freeX: input.freeX ?? 0,
    freeY: input.freeY ?? 0,
    dueDate: input.dueDate ?? null,
    assignee: null,
    customFields: input.customFields ?? {},
    tags: input.tags ?? [],
    colour: input.colour ?? 'WEISS',
    subtaskSummary: { done: 0, total: 0 },
    createdBy: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function useCreateNote(boardId: string) {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();

  return useMutation({
    mutationFn: (input: Partial<NoteCreateInput>) => notesApi.create(boardId, input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: keys.notes(boardId) });
      const previous = queryClient.getQueryData<NoteDto[]>(keys.notes(boardId));
      const tempId = `${TEMP_ID_PREFIX}${Date.now()}`;
      queryClient.setQueryData<NoteDto[]>(keys.notes(boardId), (prev) => [
        ...(prev ?? []),
        optimisticNote(boardId, tempId, input),
      ]);
      return { previous, tempId };
    },
    onError: (_err, _input, context) => {
      if (context?.previous) queryClient.setQueryData(keys.notes(boardId), context.previous);
    },
    onSuccess: (created, _input, context) => {
      queryClient.setQueryData<NoteDto[]>(keys.notes(boardId), (prev) =>
        prev?.map((n) => (n.id === context?.tempId ? created : n)),
      );
      // Deliberately NOT seeding the detail cache (keys.noteDetail) with `created`.
      // POST /notes answers with the LIGHT list DTO, which has no subtasks[]/history[],
      // while everything reading that key (useNoteDetail -> SubtaskChecklist, HistoryTrail)
      // indexes those arrays directly. Seeding it crashed the panel on the first open of a
      // freshly created note. Leaving the key empty lets useNoteDetail fetch real detail.
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: keys.notes(boardId) });
    },
  });
}
