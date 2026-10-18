import { useQueryClient } from '@tanstack/react-query';
import { useSessionMutation as useMutation } from '@/lib/useSessionMutation';
import type { NoteCreateInput, NoteDto } from '@wally/shared';
import { notesApi } from '@/lib/resources';
import { useQueryKeys } from '../queryKeys';

const TEMP_ID_PREFIX = 'temp-';

function optimisticNote(boardId: string, tempId: string, input: Partial<NoteCreateInput>): NoteDto {
  const now = new Date().toISOString();
  return {
    id: tempId,
    revision: 1,
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
    links: [],
    colour: input.colour ?? 'WEISS',
    visibility: input.visibility ?? 'SHARED',
    subtaskSummary: { done: 0, total: 0 },
    createdBy: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function useCreateNote(
  boardId: string,
  options: {
    /**
     * Hears every id the new note is shown under, each one before the cache shows it: the
     * temp id before the optimistic card lands, then the real id before it replaces the temp
     * one. The note being written in place uses it to keep its own copy off the board.
     */
    onNoteId?: (id: string) => void;
  } = {},
) {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  const { onNoteId } = options;

  return useMutation({
    mutationFn: (input: Partial<NoteCreateInput>) => notesApi.create(boardId, input),
    onMutate: (input) => {
      void queryClient.cancelQueries({ queryKey: keys.notes(boardId) });
      const previous = queryClient.getQueryData<NoteDto[]>(keys.notes(boardId));
      const tempId = `${TEMP_ID_PREFIX}${crypto.randomUUID()}`;
      onNoteId?.(tempId);
      queryClient.setQueryData<NoteDto[]>(keys.notes(boardId), (prev) => [
        ...(prev ?? []),
        optimisticNote(boardId, tempId, input),
      ]);
      return { previous, tempId };
    },
    onError: (_err, _input, context) => {
      if (context)
        queryClient.setQueryData<NoteDto[]>(keys.notes(boardId), (prev) =>
          prev?.filter((note) => note.id !== context.tempId),
        );
    },
    onSuccess: (created, _input, context) => {
      onNoteId?.(created.id);
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
