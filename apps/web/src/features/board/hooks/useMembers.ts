import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { membersApi } from '@/lib/resources';
import { useQueryKeys } from './queryKeys';

export function useMembers(boardId: string | undefined) {
  const keys = useQueryKeys();
  return useQuery({
    queryKey: keys.members(boardId ?? ''),
    queryFn: () => membersApi.list(boardId!),
    enabled: Boolean(boardId),
  });
}

/** Active members only — what note-assignment and the member-avatar stack show. */
export function useActiveMembers(boardId: string | undefined) {
  const query = useMembers(boardId);
  const activeMembers = useMemo(
    () => (query.data ?? []).filter((m) => m.status === 'ACTIVE'),
    [query.data],
  );
  return { ...query, activeMembers };
}
