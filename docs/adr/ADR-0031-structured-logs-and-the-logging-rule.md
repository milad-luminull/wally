# ADR-0031: Structured logs for Cloud Logging, and one logging rule

- **Status:** superseded by [ADR-0032](ADR-0032-structured-logs-with-opentelemetry-names.md)
- **Date:** 2026-11-22
- **Deciders:** the owner, through [RFC-0012](../rfcs/RFC-0012-observability.md) (accepted 2026-11-08)

## Context and problem statement

The API logged Fastify's default pino JSON: a numeric `level`, the text as `msg`, no trace.
Cloud Logging read every line as `DEFAULT` severity and could not group a request's lines. Two
incidents went unexplained: an expired Google sign-in made every assistant call fail with only
`assistant.provider_error` and `name: "Error"` in the log, and a 32-second model call left no
trace at all. A 5xx was logged without its stack, a failed board cleanup at `warn` without its
error, and `runMeteredCall` reported Wally's own ledger failures as the provider's. Workstream 2
of RFC-0012 will turn `error` lines into Sentry issues, so the level has to mean something first.

## Decision drivers

- No new dependency and no custom logging framework (RFC-0012 §2, §5).
- No user content in logs: database errors can repeat a note's text.
- Sentry's pino integration reads pino's numeric `level`.

## Considered options

1. **pino options in one module:** `messageKey`, `formatters.level`, `timestamp`, serializers
   and a child-logger factory. Good, because pino comes with Fastify and every option is
   documented; bad, because Fastify's types are stricter than pino and need one cast.
2. **A pino transport or a logging library** (such as a Cloud Logging client). Good, because it
   knows the format; bad, because it is a new dependency, and with several transport targets
   `formatters.level` "cannot be used to replace `level`"
   ([pino API, formatters](https://github.com/pinojs/pino/blob/main/docs/api.md#formatters)).

## Decision outcome

Chosen option: **pino options in one module**, `apps/api/src/lib/logging/`.

- Every line carries Cloud Logging's `severity` beside pino's `level`, the text as `message`, an
  ISO `time` and, on Cloud Run, `logging.googleapis.com/trace` read from
  `X-Cloud-Trace-Context` with the project from `GOOGLE_CLOUD_PROJECT`
  ([structured logging](https://docs.cloud.google.com/logging/docs/structured-logging)).
- An error is logged as `err` with its type, message, stack and string `code` only
  (`safeErrorFields`). A database error (`DrizzleQueryError`, `postgres.PostgresError`, or one
  as `cause`) keeps no message, and its stack keeps only frames after the message. pino would
  still copy an error's own message into a line logged without one (`log.error(error)`,
  `log.warn({ err })`), so a `logMethod` hook gives such a line the safe message, or the
  error's type.
- Fastify's "incoming request" and "request completed" lines are off (`LogController` with
  `disableRequestLogging`): Cloud Run's request log already records each request. Every line a
  request logs carries its method and redacted path instead (`requestChildLogger`).
- The rule (RFC-0012 §5.2): an unexpected failure logs at `error` with `err`; an expected one at
  `warn` or below. Expected means a 4xx or an `AppError` with 502, 503 or 504. A provider's own
  error is logged by shape only (name, status, code). Errors from Wally's own callbacks inside a
  model call are marked (`own` in `apps/api/src/lib/assistant/ownErrors.ts`) and rethrown.

### Consequences

- Good: Cloud Logging filters by severity and groups a request's lines under its Cloud Run
  request; the error handler's `error` lines carry a stack.
- Good: Wally's own failures in a capture or a tidy answer 500 and log at `error`, so a ledger
  outage no longer looks like a model outage.
- Bad: a database error's message is gone from the log; the SQLSTATE `code` and the stack are
  what is left to diagnose it with.
- Bad: one cast in `loggerOptions`, since Fastify types `err` as always having a message.
- Neutral: workstream 2 adds the Sentry trace id to the same lines.

### Confirmation

`apps/api/test/logging.test.ts` pins the fields, the severity of each level, the trace, the
missing request lines and the safe error fields; `errors.test.ts`, `health.test.ts`,
`boards-lifecycle.test.ts`, `assistant-suggestions.test.ts` and `assistant-tidies.test.ts` pin
the level of each call site.

## More information

- [RFC-0012](../rfcs/RFC-0012-observability.md) §5 and workstream 1.
- [Cloud Run logging](https://docs.cloud.google.com/run/docs/logging) for the trace header.
- [DEPLOY.md, Reading the API's logs](../DEPLOY.md#reading-the-apis-logs).
