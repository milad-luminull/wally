import type { FastifyLoggerOptions, FastifyServerOptions } from 'fastify';
import { safeErrorFields } from './errorFields.js';

/** Fastify's logger options: its own and pino's. */
type LoggerOptions = Exclude<FastifyServerOptions['logger'], boolean | undefined>;
type ChildLoggerFactory = NonNullable<FastifyServerOptions['childLoggerFactory']>;

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
 * A request's path as a log line may show it: the query string is dropped and share-link
 * tokens are redacted, since either can grant or reveal access. OpenTelemetry asks for the same:
 * sensitive content in `url.path` "SHOULD be scrubbed"
 * (https://opentelemetry.io/docs/specs/semconv/registry/attributes/url/).
 */
export function redactedPath(url: string): string {
  return url.split('?')[0]!.replace(/(\/share-links\/)[^/?]+/g, '$1[redacted]');
}

/**
 * What a log line may say about a request object, should one be logged as `req`: its method
 * and path, nothing else. Fastify's default request serializer also writes the client's
 * address, port and host header; an IP address is personal data, and the log has no use for it
 * (GDPR.md, GAP-05). The app's own lines carry the request as `http.request.method` and
 * `url.path` instead (`requestChildLogger`).
 */
export const requestLogSerializers = {
  req: (request: { method: string; url: string }) => ({
    method: request.method,
    url: redactedPath(request.url),
  }),
  // A backstop: `errorAsAttributes` turns every logged `err` into its safe fields, but pino
  // serializes a child logger's bindings without it. An `err` bound to a child would otherwise
  // get pino's full error serializer, with a database error's query and parameters.
  err: safeErrorFields,
};

/**
 * pino's `formatters.log`, which runs before its serializers: an error logged as `err` (or as
 * the first argument, which pino files under `err`) becomes its safe fields under
 * OpenTelemetry's flat names (`safeErrorFields`). A field the caller sets wins.
 */
function errorAsAttributes(object: Record<string, unknown>): Record<string, unknown> {
  if (object.err == null) return object;
  const { err, ...rest } = object;
  return { ...safeErrorFields(err), ...rest };
}

/**
 * The API's pino options, shaped for Cloud Logging's structured logging: `severity` beside
 * pino's numeric `level` (Sentry's pino integration reads `level`), the text as `message`, and
 * `time` as an ISO timestamp. Errors are written under OpenTelemetry's names
 * (`errorAsAttributes`). No stream: stdout, unless a caller adds one.
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
      log: errorAsAttributes,
    },
    // pino writes an error's own message as the line's `message` when a call gives none
    // (`log.error(error)`, `log.warn({ err })`), before any formatter runs. A database error's
    // message is its query and parameters, so the line's message is taken from the safe
    // fields instead: the error's message, or its type when it keeps none.
    hooks: {
      logMethod(args, method) {
        const [first] = args as unknown[];
        const err =
          first instanceof Error
            ? first
            : first !== null && typeof first === 'object' && !('message' in first)
              ? (first as { err?: unknown }).err
              : undefined;
        if (args.length !== 1 || err == null) return method.apply(this, args);
        const fields = safeErrorFields(err);
        const message = fields['exception.message'] ?? fields['exception.type'];
        return method.apply(this, [first, message] as unknown as typeof args);
      },
    },
    // Fastify types `err` as always returning a message and a stack; pino takes any object, and
    // a database error deliberately keeps no message (safeErrorFields).
    serializers: requestLogSerializers as unknown as FastifyLoggerOptions['serializers'],
  };
}

const TRACE_KEY = 'logging.googleapis.com/trace';

/**
 * The Cloud Logging trace field from Cloud Run's `X-Cloud-Trace-Context`
 * (`TRACE_ID/SPAN_ID;o=OPTIONS`), so a request's lines group under Cloud Run's own request log.
 * Nothing without a project or a 32-hex trace id (local, CI, tests).
 */
export function traceBindings(
  header: string | string[] | undefined,
  projectId: string | undefined,
): { [TRACE_KEY]?: string } {
  const value = Array.isArray(header) ? header[0] : header;
  const traceId = value?.split('/')[0];
  if (!projectId || !traceId || !/^[0-9a-f]{32}$/i.test(traceId)) return {};
  return { [TRACE_KEY]: `projects/${projectId}/traces/${traceId}` };
}

/**
 * Fastify's `childLoggerFactory`: every line a request logs carries its trace, its method as
 * `http.request.method` and its redacted path as `url.path` (OpenTelemetry's Stable names),
 * since Fastify's own per-request lines are off.
 */
export function requestChildLogger(projectId: string | undefined): ChildLoggerFactory {
  return (logger, bindings, options, rawRequest) =>
    logger.child(
      {
        ...bindings,
        ...traceBindings(rawRequest.headers['x-cloud-trace-context'], projectId),
        'http.request.method': rawRequest.method,
        'url.path': redactedPath(rawRequest.url ?? ''),
      },
      options,
    );
}
