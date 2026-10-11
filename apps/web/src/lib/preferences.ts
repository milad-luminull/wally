import { useCallback, useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  DEFAULT_PREFERENCES,
  type MeDto,
  type Preferences,
  type PreferencesUpdate,
} from '@wally/shared';
import { useMe } from '@/i18n/useProfileLanguage';
import { queryKeys } from '@/features/board/hooks/queryKeys';
import { meApi } from './resources';
import { toast } from './toast';

/** How long a burst of preference changes is held before one PATCH goes out. */
export const SAVE_DELAY_MS = 600;

/** The caller's preferences, defaulted while the profile is still loading. */
export function usePreferences(): Preferences {
  return useMe().data?.preferences ?? DEFAULT_PREFERENCES;
}

/** Applies a partial update the same way the API does: named boards replaced, null forgets. */
export function applyPreferencesUpdate(
  current: Preferences,
  update: PreferencesUpdate,
): Preferences {
  const boards = { ...current.boards };
  for (const [boardId, value] of Object.entries(update.boards ?? {})) {
    if (value === null) delete boards[boardId];
    else boards[boardId] = value;
  }
  return {
    theme: update.theme ?? current.theme,
    lastBoardId: update.lastBoardId ?? current.lastBoardId,
    boards,
  };
}

function mergeUpdates(a: PreferencesUpdate, b: PreferencesUpdate): PreferencesUpdate {
  const boards = a.boards || b.boards ? { ...a.boards, ...b.boards } : undefined;
  return { ...a, ...b, ...(boards && { boards }) };
}

/*
 * One pending write per QueryClient, shared by every caller. Flipping view, then grouping,
 * then "show done" in quick succession is three calls here and one PATCH on the wire.
 */
const pending = new WeakMap<
  QueryClient,
  { update: PreferencesUpdate; timer: ReturnType<typeof setTimeout> }
>();

function flush(queryClient: QueryClient) {
  const entry = pending.get(queryClient);
  if (!entry) return;
  pending.delete(queryClient);
  meApi.updatePreferences(entry.update).then(
    (saved) => {
      // Only adopt the server's copy if nothing newer is queued — otherwise it would briefly
      // undo a change the user made while this request was in flight.
      if (!pending.has(queryClient)) queryClient.setQueryData(queryKeys.profile(), saved);
    },
    () => {
      // The optimistic cache now disagrees with the server; refetch so the UI shows what
      // was actually saved, and say so — otherwise the view would just jump back.
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile(), exact: true });
      toast.error('toast.prefsFailed');
    },
  );
}

/**
 * Saves preferences: the cached profile updates immediately (the UI is the feedback), and
 * the write is debounced. Pending writes are flushed when the page is hidden so a change
 * made just before closing the tab still lands.
 */
export function useSavePreferences() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushPreferences(queryClient);
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [queryClient]);

  return useCallback(
    (update: PreferencesUpdate) => {
      // A refetch landing mid-debounce would carry the pre-change profile and undo this.
      void queryClient.cancelQueries({ queryKey: queryKeys.profile(), exact: true });
      queryClient.setQueryData<MeDto>(queryKeys.profile(), (old) =>
        old ? { ...old, preferences: applyPreferencesUpdate(old.preferences, update) } : old,
      );

      const existing = pending.get(queryClient);
      if (existing) clearTimeout(existing.timer);
      const merged = existing ? mergeUpdates(existing.update, update) : update;
      pending.set(queryClient, {
        update: merged,
        timer: setTimeout(() => flush(queryClient), SAVE_DELAY_MS),
      });
    },
    [queryClient],
  );
}

/** Sends any held preference write right away. */
export function flushPreferences(queryClient: QueryClient) {
  const entry = pending.get(queryClient);
  if (entry) clearTimeout(entry.timer);
  flush(queryClient);
}

/** Records the open board as the one `/` returns to. A no-op once it already is. */
export function useRememberLastBoard(boardId: string) {
  const me = useMe();
  const save = useSavePreferences();
  const lastBoardId = me.data?.preferences.lastBoardId;
  const loaded = me.data !== undefined;

  useEffect(() => {
    if (loaded && lastBoardId !== boardId) save({ lastBoardId: boardId });
  }, [boardId, lastBoardId, loaded, save]);
}
