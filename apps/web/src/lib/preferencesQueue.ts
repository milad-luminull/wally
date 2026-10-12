import type { QueryClient } from '@tanstack/react-query';
import type { PreferencesUpdate } from '@wally/shared';
import type { QueryKeys } from '@/features/board/hooks/queryKeys';
import { meApi } from './resources';
import { toast } from './toast';

/**
 * The debounced preferences write, apart from the hooks in preferences.ts so AuthProvider can
 * flush or drop it on a change of account without importing the profile hooks (which import
 * AuthProvider back).
 */

/** How long a burst of preference changes is held before one PATCH goes out. */
export const SAVE_DELAY_MS = 600;

const sameKey = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((part, i) => part === b[i]);

function mergeUpdates(a: PreferencesUpdate, b: PreferencesUpdate): PreferencesUpdate {
  const boards = a.boards || b.boards ? { ...a.boards, ...b.boards } : undefined;
  return { ...a, ...b, ...(boards && { boards }) };
}

/*
 * One pending write per QueryClient, shared by every caller. Flipping view, then grouping,
 * then "show done" in quick succession is three calls here and one PATCH on the wire.
 *
 * The entry remembers the keys of the user who made the change. The request itself carries
 * whoever is signed in when it is SENT, which is why a change of account has to flush or
 * discard it first (AuthProvider) — never let it go out under the next user's token.
 */
const pending = new WeakMap<
  QueryClient,
  { update: PreferencesUpdate; keys: QueryKeys; timer: ReturnType<typeof setTimeout> }
>();

function flush(queryClient: QueryClient): Promise<void> {
  const entry = pending.get(queryClient);
  if (!entry) return Promise.resolve();
  pending.delete(queryClient);
  const { keys } = entry;
  return meApi.updatePreferences(entry.update).then(
    (saved) => {
      // Only adopt the server's copy if nothing newer is queued — otherwise it would briefly
      // undo a change the user made while this request was in flight.
      if (!pending.has(queryClient)) queryClient.setQueryData(keys.profile(), saved);
    },
    () => {
      // The optimistic cache now disagrees with the server; refetch so the UI shows what
      // was actually saved, and say so — otherwise the view would just jump back.
      void queryClient.invalidateQueries({ queryKey: keys.profile(), exact: true });
      toast.error('toast.prefsFailed');
    },
  );
}

/** Holds `update` (merged with anything already held) and restarts the debounce. */
export function queuePreferences(
  queryClient: QueryClient,
  keys: QueryKeys,
  update: PreferencesUpdate,
) {
  const existing = pending.get(queryClient);
  if (existing) clearTimeout(existing.timer);
  // A queue left by another account is dropped rather than merged — AuthProvider normally
  // discards it first; this only guards the gap before that runs.
  const sameUser = existing && sameKey(existing.keys.profile(), keys.profile());
  const carried = sameUser ? existing : null;
  pending.set(queryClient, {
    update: carried ? mergeUpdates(carried.update, update) : update,
    keys,
    timer: setTimeout(() => void flush(queryClient), SAVE_DELAY_MS),
  });
}

/** Sends any held preference write right away. Resolves once it has been answered. */
export function flushPreferences(queryClient: QueryClient): Promise<void> {
  const entry = pending.get(queryClient);
  if (entry) clearTimeout(entry.timer);
  return flush(queryClient);
}

/** Forgets any held preference write without sending it. */
export function discardPendingPreferences(queryClient: QueryClient) {
  const entry = pending.get(queryClient);
  if (entry) clearTimeout(entry.timer);
  pending.delete(queryClient);
}
