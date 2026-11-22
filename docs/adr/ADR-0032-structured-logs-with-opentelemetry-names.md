# ADR-0032: Structured logs with OpenTelemetry names, and one logging rule

- **Status:** accepted
- **Date:** 2026-11-22
- **Deciders:** the owner, through [RFC-0012](../rfcs/RFC-0012-observability.md) §5 rule 6
  (standards first, 2026-11-22)
- **Supersedes:** [ADR-0031](ADR-0031-structured-logs-and-the-logging-rule.md)

## Context and problem statement

ADR-0031 gave the API structured logs for Cloud Logging and one logging rule, with field names
of Wally's own: an error as `err` (`type`, `message`, `stack`, `code`), a request as `req`
(`method`, `url`), a response as `status` and `code`. The owner then asked for documented
standards wherever one exists. OpenTelemetry's semantic conventions name exactly these fields,
as Stable attributes. ADR-0031 has not been released, so the names can change once, before
anyone queries them.

## Decision drivers

- A Stable standard over Wally's own names (RFC-0012 §5 rule 6).
- No new dependency, no change to what a line may contain (no user content).
- Cloud Logging stays the reader: its own keys (`severity`, `message`, `time`, the trace) stay.

## Considered options

1. **OpenTelemetry names, written flat by pino's `formatters.log`.** Good, because the names are
   the Stable conventions and one documented pino option writes them; bad, because the keys
   contain dots, so a Logs Explorer query must quote them (`jsonPayload."error.type"`).
2. **Keep ADR-0031's names.** Good, because nothing changes; bad, because they are Wally's own
   where a standard exists, and Sentry and other tools read the standard names.
3. **Also rename Wally's own fields** (`type`, `operationId`) to an app prefix in snake_case.
   Good, because OpenTelemetry's naming guide recommends it; bad, because it is only a
   recommendation, the fields never enter an OpenTelemetry pipeline, and every call site would
   change for nothing.

## Decision outcome

Chosen option: **OpenTelemetry names, written flat**. ADR-0031 stands in everything else: the
Cloud Logging keys, the trace field (until RFC-0012 workstream 2 replaces it), no per-request
lines, no database message, and the logging rule.

- An error is logged as `err` and written as `exception.type`, `exception.message` and
  `exception.stacktrace`
  ([exceptions in logs](https://opentelemetry.io/docs/specs/semconv/exceptions/exceptions-logs/)),
  with `error.type` set to its string code, else its type
  ([`error.type`](https://opentelemetry.io/docs/specs/semconv/registry/attributes/error/)).
  A code Postgres returned is also `db.response.status_code`
  ([database](https://opentelemetry.io/docs/specs/semconv/registry/attributes/db/)). A field
  the caller sets wins.
- Every line a request logs carries `http.request.method` and `url.path`, the path without its
  query and with share tokens redacted
  ([HTTP](https://opentelemetry.io/docs/specs/semconv/registry/attributes/http/),
  [URL](https://opentelemetry.io/docs/specs/semconv/registry/attributes/url/)).
- The error handler's lines carry `http.response.status_code`, `http.route` and, for an
  expected failure, `error.type` from the response's code.
- The rule is ADR-0031's: an unexpected failure logs at `error` with `err`; an expected one
  (a 4xx, an `AppError` with 502, 503 or 504) at `warn` or below.

### Consequences

- Good: the fields mean what the standard says, for any tool that reads them.
- Good: one place writes them (`errorAsAttributes` in `apps/api/src/lib/logging/options.ts`),
  so a call site still just logs `{ err }`.
- Bad: dotted keys need quoting in Logs Explorer queries.
- Bad: a non-`AppError` 500 no longer names the response code `INTERNAL_SERVER_ERROR`; its
  status says the same.
- Neutral: Wally's own fields keep their names, a recommendation not followed on purpose.

### Confirmation

`apps/api/test/logging.test.ts` pins the names, the database status code and the caller's
`error.type`; `errors.test.ts`, `health.test.ts`, `boards-lifecycle.test.ts`,
`assistant-suggestions.test.ts` and `assistant-tidies.test.ts` pin each call site.

## More information

- [RFC-0012](../rfcs/RFC-0012-observability.md) §5 rule 6 and the workstream 1 follow-up.
- [DEPLOY.md, Reading the API's logs](../DEPLOY.md#reading-the-apis-logs).
