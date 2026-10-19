import { z } from 'zod';

/**
 * Every error the API answers, in one shape (the error handling spec, 2026-10-19). `error` is
 * a stable code; `message` is English and machine-ish, never shown as is; `retryable` says
 * whether sending the same request again can help; `resetsAt` is when a budget cap lifts.
 */
export const apiErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
  retryable: z.boolean(),
  resetsAt: z.string().nullable().optional(),
});
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;

/** The codes a retry can fix: a fault on our side, or a moment's contention. */
export const RETRYABLE_ERROR_CODES = [
  'INTERNAL_SERVER_ERROR',
  'RATE_LIMITED',
  'ASSISTANT_BUSY',
  'ASSISTANT_PROVIDER_ERROR',
  'ASSISTANT_TIMEOUT',
] as const;
