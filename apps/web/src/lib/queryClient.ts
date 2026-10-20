import { MutationCache, QueryClient } from '@tanstack/react-query';
import type { MessageKey } from '@/i18n/keys';
import { failureOf } from './errors';
import { getRecoveries, retryMutation } from './mutationQueue';
import { toast } from './toast';

/** Why a write was refused, in the person's words (the error handling spec, 2026-10-19). */
function refusedReason(code: string | undefined, status: unknown): MessageKey {
  if (code === 'INVALID_ASSIGNEE') return 'errors.refused.assignee';
  if (code === 'LINK_TARGET_INVALID') return 'errors.refused.link';
  if (code === 'FORBIDDEN' || status === 403) return 'errors.refused.forbidden';
  if (code === 'NOT_FOUND' || status === 404) return 'errors.refused.gone';
  return 'errors.refused.other';
}

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: {
      /** The mutation reports its own failure inline, so the global toast stays out of it. */
      silentError?: boolean;
    };
  }
}

export const queryClient = new QueryClient({
  /*
   * Every optimistic mutation rolls itself back on failure. Without a word, a failed drag,
   * rename or invite just snaps back and looks like the app ignored you — so any failure
   * that isn't already reported where it happened gets one toast, here, for all of them.
   */
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (mutation.meta?.silentError) return;
      // One message per failure, by its kind: a conflict has the review dialog, an expired
      // session the sign-in screen, and a cancelled request is no failure.
      const failure = failureOf(error);
      if (!failure || failure.kind === 'conflict' || failure.kind === 'session') return;
      if (failure.code === 'PRECONDITION_REQUIRED') {
        toast.error('safety.reload');
        return;
      }
      if (failure.kind === 'refused' || failure.kind === 'limit') {
        toast({
          title: refusedReason(failure.code, (error as { status?: unknown }).status),
          tone: 'error',
        });
        return;
      }
      // For a moment: the write stays in the unsaved list, and Try again sends it now.
      const recovery = getRecoveries().find((item) => item.error === error);
      toast({
        title: 'errors.saveFailed',
        tone: 'error',
        ...(recovery
          ? {
              action: {
                label: 'common.retry',
                onClick: () => void retryMutation(recovery.ticket.operationId).catch(() => {}),
              },
            }
          : {}),
      });
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (failureCount, error) => {
        const status = (error as { status?: number } | undefined)?.status;
        if (status === 401 || status === 403 || status === 404) return false;
        return failureCount < 2;
      },
    },
    mutations: {
      retry: false,
    },
  },
});
