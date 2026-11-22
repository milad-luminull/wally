import type { FastifyLoggerOptions, FastifyServerOptions } from 'fastify';
import { safeErrorFields } from './errorFields.js';

/** Fastify's logger options: its own and pino's. */
type LoggerOptions = Exclude<FastifyServerOptions['logger'], boolean | undefined>;

type Level = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
type Severity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

/** pino's levels as Cloud Logging's `severity` (LogSeverity). */
export const SEVERITY: Record<Level, Severity> = {
  trace: 'DEBUG',
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
  fatal: 'CRITICAL',
};

/**
 * What a request log line may say about a request: its method and path, nothing else. Fastify's
 * default request serializer also writes the client's address, port and host header; an IP
 * address is personal data, and the request log has no use for it (GDPR.md, GAP-05). The query
 * string is dropped and share-link tokens are redacted, since either can grant or reveal access.
 */
export const requestLogSerializers = {
  req: (request: { method: string; url: string }) => ({
    method: request.method,
    url: request.url.split('?')[0]!.replace(/(\/share-links\/)[^/?]+/g, '$1[redacted]'),
  }),
  err: safeErrorFields,
};

/**
 * The API's pino options, shaped for Cloud Logging's structured logging: `severity` beside
 * pino's numeric `level` (Sentry's pino integration reads `level`), the text as `message`, and
 * `time` as an ISO timestamp. No stream: stdout, unless a caller adds one.
 */
export function loggerOptions(): LoggerOptions & { messageKey: 'message' } {
  return {
    messageKey: 'message',
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    formatters: {
      level: (label: string, number: number) => ({
        severity: SEVERITY[label as Level],
        level: number,
      }),
    },
    // Fastify types `err` as always returning a message and a stack; pino takes any object, and
    // a database error deliberately keeps no message (safeErrorFields).
    serializers: requestLogSerializers as unknown as FastifyLoggerOptions['serializers'],
  };
}
