/** Central cache-key factory — every board query/mutation goes through these so
 * invalidation and optimistic patches never typo a key by hand. */
export const queryKeys = {
  meBoards: () => ['me', 'boards'] as const,
  /** NOTE: shares the ['me'] prefix with meBoards, so never invalidate the bare prefix —
   * that would throw away the boards list too. Always invalidate this exact key. */
  profile: () => ['me', 'profile'] as const,
  board: (boardId: string) => ['boards', boardId] as const,
  notes: (boardId: string) => ['boards', boardId, 'notes'] as const,
  members: (boardId: string) => ['boards', boardId, 'members'] as const,
  /** No dedicated GET /invites route on the backend (see plan) — pending invites are
   * PENDING-status rows inside the members list. Kept as its own key anyway so the
   * optimistic-invite mutation has a stable, documented target, aliased onto the same
   * underlying members cache entry (see useCreateInvite). */
  invites: (boardId: string) => ['boards', boardId, 'invites'] as const,
  shareLink: (boardId: string) => ['boards', boardId, 'shareLink'] as const,
};
