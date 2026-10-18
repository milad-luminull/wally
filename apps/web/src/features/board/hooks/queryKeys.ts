import { createContext, useContext, useMemo } from 'react';

/**
 * Central cache-key factory — every query/mutation goes through these so invalidation and
 * optimistic patches never typo a key by hand.
 *
 * Every key is rooted at the signed-in user (`['u', uid, …]`). The QueryClient outlives a
 * sign-out, and none of these resources are addressed by user — `/me` is whoever is calling
 * — so an unscoped key would serve Alice's profile and boards to Bob. AuthProvider also
 * clears the cache on every identity change; the scope is what keeps a request or mutation
 * callback still in flight from Alice's session writing into Bob's cache afterwards, because
 * it captured Alice's keys.
 */
export function scopedQueryKeys(uid: string | null) {
  const root = ['u', uid ?? 'anon'] as const;
  return {
    meBoards: () => [...root, 'me', 'boards'] as const,
    /** NOTE: shares the ['me'] prefix with meBoards, so never invalidate the bare prefix —
     * that would throw away the boards list too. Always invalidate this exact key. */
    profile: () => [...root, 'me', 'profile'] as const,
    board: (boardId: string) => [...root, 'boards', boardId] as const,
    notes: (boardId: string) => [...root, 'boards', boardId, 'notes'] as const,
    /** Local undo windows, kept separately from server note-list refreshes. */
    pendingNoteDeletes: (boardId: string) =>
      [...root, 'boards', boardId, 'pending-deletes'] as const,
    /** One note's full detail (subtasks[], history[]) — see hooks/mutations/shared.ts. */
    noteDetail: (noteId: string) => [...root, 'notes', noteId] as const,
    members: (boardId: string) => [...root, 'boards', boardId, 'members'] as const,
    /** No dedicated GET /invites route on the backend (see plan) — pending invites are
     * PENDING-status rows inside the members list. Kept as its own key anyway so the
     * optimistic-invite mutation has a stable, documented target, aliased onto the same
     * underlying members cache entry (see useCreateInvite). */
    invites: (boardId: string) => [...root, 'boards', boardId, 'invites'] as const,
    shareLink: (boardId: string) => [...root, 'boards', boardId, 'shareLink'] as const,
    /** The board's suggestions still waiting for a decision (shown again after a reload). */
    assistantPending: (boardId: string) =>
      [...root, 'boards', boardId, 'assistant', 'pending'] as const,
  };
}

export type QueryKeys = ReturnType<typeof scopedQueryKeys>;

/**
 * The signed-in uid, provided by AuthProvider. Its own context rather than useAuth() so this
 * module stays free of the auth module, and so a hook rendered without an AuthProvider (a
 * unit test) falls back to the anonymous scope instead of throwing.
 */
export const QueryScopeContext = createContext<string | null>(null);

/** The key factory for whoever is signed in right now. */
export function useQueryKeys(): QueryKeys {
  const uid = useContext(QueryScopeContext);
  return useMemo(() => scopedQueryKeys(uid), [uid]);
}
