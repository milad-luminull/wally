# ADR-0006: Server state lives in TanStack Query; no global store and no real-time channel

- **Status:** accepted; the "no real-time channel" rule is superseded by [ADR-0023](ADR-0023-supabase-realtime-for-notification-events.md)
- **Date:** 2026-09-18
- **Deciders:** Milad Rezazadeh

## Context and problem statement

The board renders the same notes in a canvas and in a list, and a drag must land instantly even though the API call that records it takes a round trip. Boards can be shared, so two people may edit the same board. Where does the browser keep server data, and how does it learn about changes it did not make?

## Decision drivers

- A move, rename or completion must appear immediately and snap back if the server rejects it.
- Only the API talks to Firestore (ADR-0003), so the browser cannot subscribe to the database.
- Real-time collaborative editing is out of scope ([`SPEC.md`](../SPEC.md), section 14).

## Considered options

1. **TanStack Query as the only cache, optimistic mutations, freshness by stale time and invalidation:** good, because caching, retries, invalidation and rollback are one library and there is no second source of truth; bad, because another user's change shows up only on the next refetch.
2. **A global store (Redux or zustand) mirroring server data:** good, because any component can read anything; bad, because the store and the server drift, and every mutation has to update both.
3. **Firestore `onSnapshot` listeners in the browser:** good, because live updates for free; bad, because it needs the client SDK and open security rules, which ADR-0003 rules out.

## Decision outcome

Chosen option: **TanStack Query only**.

- Query keys are defined once in `apps/web/src/features/board/hooks/queryKeys.ts`. The default `staleTime` is 15 seconds ([`apps/web/src/lib/queryClient.ts`](../../apps/web/src/lib/queryClient.ts)); a mutation invalidates the keys it touched.
- Every note mutation is a small hook over the shared optimistic pattern in [`apps/web/src/features/board/hooks/mutations/shared.ts`](../../apps/web/src/features/board/hooks/mutations/shared.ts): cancel in-flight refetches of both the list and the detail cache, snapshot, patch, roll back on error, refetch on settle.
- One `MutationCache.onError` in `queryClient.ts` shows a single "save failed" toast for any mutation that does not report its own failure.
- There is no Redux, zustand or similar. The only React context is for the copy-on-drag gesture.
- There is no WebSocket, server-sent events or polling loop. Another person's edit appears on the next refetch.

### Consequences

- Good: one cache, one invalidation model, and a failed drag visibly snaps back.
- Good: no duplicated server state to keep in sync.
- Bad: a shared board is eventually consistent between its members, on the order of the stale time plus the next focus or mutation.
- Bad: the optimistic code is subtle. `cancelQueries` must run with `revert: false` and must not be awaited, or the note flickers back to its origin for a frame. The comment in `shared.ts` records why.
- Neutral: if live updates are ever required, the path is a server-sent event stream from the API, not a database listener in the browser.

### Confirmation

The mutation hooks with logic (`useMoveNote`, `useCreateNote`, `useDuplicateNote`, `useCustomFieldMutations`) have Vitest tests next to them. The E2E suite covers one happy path per flow.

## More information

- Responsive rules, including that drag is desktop-only: [`SPEC.md`](../SPEC.md), section 11.
