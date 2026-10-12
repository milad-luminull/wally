import { MutationCache, QueryClient } from '@tanstack/react-query';
import { toast } from './toast';

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
      if (mutation.meta?.silentError || (error as Error)?.name === 'AbortError') return;
      const code = (error as { code?: string })?.code;
      if (code === 'STALE_REVISION' || code === 'MUTATION_BLOCKED') return;
      if (code === 'PRECONDITION_REQUIRED') {
        toast.error('safety.reload');
        return;
      }
      toast.error('toast.saveFailed');
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
