import { useQuery } from '@tanstack/react-query';
import { notesApi } from '@/lib/resources';
import { useQueryKeys } from './queryKeys';

/** Full note detail (subtasks[], history[]) for the note-detail panel — see the doc
 * comment on hooks/mutations/shared.ts for why this key exists alongside the board-scoped
 * notes list. */
export function useNoteDetail(noteId: string | null) {
  const keys = useQueryKeys();
  return useQuery({
    queryKey: keys.noteDetail(noteId ?? ''),
    queryFn: () => notesApi.get(noteId!),
    enabled: Boolean(noteId),
  });
}
