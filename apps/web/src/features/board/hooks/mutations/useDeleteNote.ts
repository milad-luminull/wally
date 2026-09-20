import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { NoteDto } from '@wally/shared';
import { notesApi } from '@/lib/resources';
import { queryKeys } from '../queryKeys';

export function useDeleteNote(boardId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (noteId: string) => notesApi.remove(noteId),
    onMutate: async (noteId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.notes(boardId) });
      const previous = queryClient.getQueryData<NoteDto[]>(queryKeys.notes(boardId));
      queryClient.setQueryData<NoteDto[]>(queryKeys.notes(boardId), (prev) =>
        prev?.filter((n) => n.id !== noteId),
      );
      queryClient.removeQueries({ queryKey: ['notes', noteId] });
      return { previous };
    },
    onError: (_err, _noteId, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.notes(boardId), context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notes(boardId) });
    },
  });
}
