import { useMutation, type UseMutationOptions } from '@tanstack/react-query';
import { assertCurrentSession, isCurrentSession, sessionGeneration } from './mutationQueue';

/** A completed old-session mutation must not restore data after AuthProvider cleared it. */
export function useSessionMutation<
  TData = unknown,
  TError = Error,
  TVariables = void,
  TContext = unknown,
>(options: UseMutationOptions<TData, TError, TVariables, TContext>) {
  const generation = sessionGeneration();
  return useMutation<TData, TError, TVariables, TContext>({
    ...options,
    mutationFn: async (...args) => {
      assertCurrentSession(generation);
      const data = await options.mutationFn!(...args);
      assertCurrentSession(generation);
      return data;
    },
    ...(options.onMutate
      ? {
          onMutate: async (...args: Parameters<NonNullable<typeof options.onMutate>>) => {
            assertCurrentSession(generation);
            return options.onMutate!(...args);
          },
        }
      : {}),
    onError: (...args) => {
      if (isCurrentSession(generation)) return options.onError?.(...args);
    },
    onSuccess: (...args) => {
      if (isCurrentSession(generation)) return options.onSuccess?.(...args);
    },
    onSettled: (...args) => {
      if (isCurrentSession(generation)) return options.onSettled?.(...args);
    },
  });
}
