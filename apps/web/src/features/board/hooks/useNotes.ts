import { useQuery } from '@tanstack/react-query';
import { notesApi } from '@/lib/resources';
import { useQueryKeys } from './queryKeys';

/**
 * The single source of truth for a board's notes. WandView and ListView both call this
 * same hook and derive their filtered/grouped presentation via useMemo — never fetch or
 * duplicate the notes list per view (see the util/noteDerived helpers).
 */
export function useNotes(boardId: string | undefined) {
  const keys = useQueryKeys();
  return useQuery({
    queryKey: keys.notes(boardId ?? ''),
    queryFn: () => notesApi.list(boardId!, { status: 'ALL' }),
    enabled: Boolean(boardId),
  });
}
