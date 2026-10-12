import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { MeDto } from '@wally/shared';
import { meApi } from '@/lib/resources';
import { useQueryKeys } from '@/features/board/hooks/queryKeys';
import { useAuth } from '@/features/auth/AuthProvider';
import { normalizeLocale, FALLBACK_LOCALE, type AppLocale } from './locales';
import { writeStoredLocale } from './storage';

/**
 * The signed-in caller's profile. Gated on auth: an anonymous visitor on /login or a share
 * link must not fire an unauthenticated request just to find out which language to render in
 * — detection already answered that synchronously before first paint.
 */
export function useMe() {
  const { status } = useAuth();
  const keys = useQueryKeys();
  return useQuery({
    queryKey: keys.profile(),
    queryFn: meApi.get,
    enabled: status === 'authenticated',
  });
}

/**
 * Switches language optimistically and persists it to the profile.
 *
 * Optimistic because the UI *is* the feedback here: waiting for the round trip would leave the
 * menu sitting in the old language for the length of a PATCH, which reads as a dead control.
 * On failure everything is put back — i18next, localStorage and the cached profile — and the
 * caller is told, so the UI never disagrees with what was actually saved.
 */
export function useUpdateLanguage() {
  const { i18n } = useTranslation();
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  const [saveFailed, setSaveFailed] = useState(false);

  const mutation = useMutation({
    mutationFn: (language: AppLocale) => meApi.updateLanguage(language),
    // The account menu says so inline, beside the control that failed.
    meta: { silentError: true },
    onSettled: () => {
      // The EXACT key: keys.meBoards() shares the ['me'] prefix, and invalidating that
      // would throw away the boards list as collateral.
      void queryClient.invalidateQueries({ queryKey: keys.profile() });
    },
  });

  const { mutate } = mutation;

  const setLanguage = useCallback(
    (next: AppLocale) => {
      const previous = normalizeLocale(i18n.language) ?? FALLBACK_LOCALE;
      if (next === previous) return;

      setSaveFailed(false);
      void i18n.changeLanguage(next);
      writeStoredLocale(next);
      queryClient.setQueryData<MeDto>(keys.profile(), (old) =>
        old ? { ...old, language: next } : old,
      );

      mutate(next, {
        onError: () => {
          void i18n.changeLanguage(previous);
          writeStoredLocale(previous);
          queryClient.setQueryData<MeDto>(keys.profile(), (old) =>
            old ? { ...old, language: previous } : old,
          );
          setSaveFailed(true);
        },
      });
    },
    [i18n, keys, mutate, queryClient],
  );

  return { setLanguage, isSaving: mutation.isPending, saveFailed };
}
