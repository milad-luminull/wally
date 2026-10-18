import { useNoteDrafts, withNoteDraft } from '@/lib/noteDrafts';
import { skipToken, useQuery } from '@tanstack/react-query';
import { notesApi } from '@/lib/resources';
import { useQueryKeys } from './queryKeys';

/**
 * The single source of truth for a board's notes. WallView and ListView both call this
 * same hook and derive their filtered/grouped presentation via useMemo — never fetch or
 * duplicate the notes list per view (see the util/noteDerived helpers).
 */
export function useNotes(boardId: string | undefined) {
  const keys = useQueryKeys();
  useNoteDrafts();
  const { data: pendingDeletes = [] } = useQuery<string[]>({
    queryKey: keys.pendingNoteDeletes(boardId ?? ''),
    initialData: [],
    queryFn: skipToken,
    enabled: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const query = useQuery({
    queryKey: keys.notes(boardId ?? ''),
    queryFn: () => notesApi.list(boardId!, { status: 'ALL' }),
    enabled: Boolean(boardId),
  });
  return {
    ...query,
    data: query.data?.filter((note) => !pendingDeletes.includes(note.id)).map(withNoteDraft),
  };
}
