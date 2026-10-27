import { useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_PREFERENCES,
  type CanvasPattern,
  type MeDto,
  type Preferences,
  type PreferencesUpdate,
  type WallybotPreferences,
} from '@wally/shared';
import { useMe } from '@/i18n/useProfileLanguage';
import { useQueryKeys } from '@/features/board/hooks/queryKeys';
import { flushPreferences, queuePreferences } from './preferencesQueue';

export { SAVE_DELAY_MS, flushPreferences } from './preferencesQueue';

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
    palette: update.palette ?? current.palette,
    canvas: update.canvas ?? current.canvas,
    lastBoardId: update.lastBoardId ?? current.lastBoardId,
    boards,
    wallybot: update.wallybot ?? current.wallybot,
  };
}

/**
 * Saves preferences: the cached profile updates immediately (the UI is the feedback), and
 * the write is debounced. Pending writes are flushed when the page is hidden so a change
 * made just before closing the tab still lands.
 */
export function useSavePreferences() {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flushPreferences(queryClient);
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [queryClient]);

  return useCallback(
    (update: PreferencesUpdate) => {
      // A refetch landing mid-debounce would carry the pre-change profile and undo this.
      void queryClient.cancelQueries({ queryKey: keys.profile(), exact: true });
      queryClient.setQueryData<MeDto>(keys.profile(), (old) =>
        old ? { ...old, preferences: applyPreferencesUpdate(old.preferences, update) } : old,
      );
      queuePreferences(queryClient, keys, update);
    },
    [keys, queryClient],
  );
}

/** The free canvas's backdrop, read from and saved to the profile. */
export function useCanvasPattern() {
  const pattern = usePreferences().canvas;
  const save = useSavePreferences();
  const setPattern = useCallback((canvas: CanvasPattern) => save({ canvas }), [save]);
  return [pattern, setPattern] as const;
}

/** Wallybot's one setting so far (RFC-0005-wallybot-inline.md §3.7): off means every proposal waits. */
export function useWallybotPreferences() {
  const wallybot = usePreferences().wallybot;
  const save = useSavePreferences();
  const setWallybot = useCallback((next: WallybotPreferences) => save({ wallybot: next }), [save]);
  return [wallybot, setWallybot] as const;
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
