import { useQuery } from '@tanstack/react-query';
import { notesApi } from '@/lib/resources';

/** Full note detail (subtasks[], history[]) for the note-detail panel — see the doc
 * comment on hooks/mutations/shared.ts for why this key exists alongside the board-scoped
 * notes list. */
export function useNoteDetail(noteId: string | null) {
  return useQuery({
    queryKey: ['notes', noteId ?? ''],
    queryFn: () => notesApi.get(noteId!),
    enabled: Boolean(noteId),
  });
}
