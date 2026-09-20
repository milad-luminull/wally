import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { membersApi } from '@/lib/resources';
import { queryKeys } from './queryKeys';

export function useMembers(boardId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.members(boardId ?? ''),
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

/** Derived from the same members query — see queryKeys.invites' doc comment. */
export function usePendingInvites(boardId: string | undefined) {
  const query = useMembers(boardId);
  const pendingInvites = useMemo(
    () => (query.data ?? []).filter((m) => m.status === 'PENDING'),
    [query.data],
  );
  return { ...query, pendingInvites };
}
