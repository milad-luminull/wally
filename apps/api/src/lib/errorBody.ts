import { RETRYABLE_ERROR_CODES, type ApiErrorBody } from '@wally/shared';
import { AppError } from './errors.js';

/** The framework's own 4xx statuses, each with its own code rather than one catch-all. */
const FRAMEWORK_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED',
};

const retryable = (status: number, code: string) =>
  status >= 500 || (RETRYABLE_ERROR_CODES as readonly string[]).includes(code);

/**
 * The status and body for any error a route throws (the error handling spec, 2026-10-19): an
 * AppError keeps its status and code, the framework's 4xx get their own codes, and anything
 * else is a 500 whose text is never sent.
 */
export function errorReplyFor(error: unknown): { status: number; body: ApiErrorBody } {
  if (error instanceof AppError) {
    const resetsAt = (error as { resetsAt?: unknown }).resetsAt;
    return {
      status: error.statusCode,
      body: {
        error: error.code,
        message: error.message,
        retryable:
          retryable(error.statusCode, error.code) &&
          // A budget cap lifts at a time; sending the request again before then cannot help.
          resetsAt == null,
        ...(resetsAt !== undefined ? { resetsAt: resetsAt as string | null } : {}),
      },
    };
  }
  const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
  const status = typeof statusCode === 'number' && statusCode >= 400 ? statusCode : 500;
  if (status >= 500)
    return {
      status,
      body: { error: 'INTERNAL_SERVER_ERROR', message: 'Unexpected error', retryable: true },
    };
  const code = FRAMEWORK_CODES[status] ?? 'REQUEST_FAILED';
  return {
    status,
    body: { error: code, message: (error as Error).message, retryable: retryable(status, code) },
  };
}
