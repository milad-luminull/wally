# Logging foundation (RFC-0012 workstream 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The API's logs arrive in Cloud Logging with a real severity, one message field, an ISO
time and the request's trace, never carry user content or credentials, and follow one rule:
unexpected failures at `error`, expected ones at `warn` or below.

**Architecture:** One logging module, `apps/api/src/lib/logging/`, owns everything pino is told:
options, serializers, the safe error fields and the per-request bindings. `app.ts` passes it to
Fastify and turns Fastify's own per-request lines off. Four call sites move to the rule. No new
dependency: pino comes with Fastify, and the only imports are from `fastify`, `drizzle-orm` and
`postgres`, all already dependencies.

**Tech Stack:** Fastify 5.12 (pino 10), TypeScript ESM, Vitest, Drizzle 0.45, postgres.js 3.4.

**Spec:** [RFC-0012](../../rfcs/RFC-0012-observability.md) §5 and §7 workstream 1.

## Global Constraints

- No new npm dependency (RFC-0012 §5; a new one also needs a container image rebuild).
- No Sentry code: Sentry arrives in workstream 2. The Sentry trace id on log lines is added there.
- Cloud Logging keys, verbatim: `severity`, `message`, `time`, `logging.googleapis.com/trace`
  ([structured logging](https://docs.cloud.google.com/logging/docs/structured-logging)).
- Trace value format: `projects/<project>/traces/<traceId>`, from `X-Cloud-Trace-Context`
  (`TRACE_ID/SPAN_ID;o=OPTIONS`) ([Cloud Run logging](https://docs.cloud.google.com/run/docs/logging)).
- pino's numeric `level` stays on every line beside `severity` (Sentry's pino integration reads it).
- Expected = 4xx, or an `AppError` with status 502, 503 or 504. Everything else that fails is
  unexpected. A provider's own error is logged by shape only (name, status, code), never its
  message (RFC-0012 §5.2).
- English identifiers and test data only (repo rule).
- Docs cite code by file and symbol, never by line number (`docs/README.md`).

## Review Focus

1. **A failed Drizzle query.** `DrizzleQueryError`'s message is `Failed query: <sql>\nparams: <values>`,
   and its `params` and `query` are own properties; the values can be a note's text. Expected:
   no message, no query, no params in the line, and no message hidden in the first line of the
   stack. Pinned in Task 1.
2. **A Postgres error that echoes input** (`invalid input syntax for type uuid: "…"`). Expected:
   name and SQLSTATE `code` only. Pinned in Task 1.
3. **A missing, empty or malformed `X-Cloud-Trace-Context`, or no project id** (local, CI, tests).
   Expected: the line simply has no trace field; nothing throws. Pinned in Task 2.
4. **Something thrown that is not an `Error`** (a string, `null`, an object without `stack`).
   Expected: a line with what is known, no crash in the serializer. Pinned in Task 1.
5. **An `AppError` 503 (`MCP_DISABLED`) or a 504 (`ASSISTANT_TIMEOUT`).** Expected: `warn`, not an
   `error` that would become a Sentry issue later. An `AppError` 500 (`ASSISTANT_PRICE_MISSING`):
   `error`. Pinned in Task 3.

---

## Running the tests

The worktree must not use `make test`: the compose project would collide with the owner's live
stack. The worktree has no `node_modules` of its own yet, so install first (`pnpm install
--frozen-lockfile` at the worktree root), then run the API tests on the host against a
throwaway Postgres:

```bash
docker run -d --rm --name wally-pg-logging -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55434:5432 supabase/postgres:17.11.0.003
```

```bash
cd apps/api && DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55434/postgres pnpm vitest run <files>
```

Stop the container (`docker stop wally-pg-logging`) when the branch is done.

### Task 1: the logging module

**Files:**

- Create: `apps/api/src/lib/logging/errorFields.ts`
- Create: `apps/api/src/lib/logging/options.ts`
- Create: `apps/api/src/lib/logging/index.ts` (re-exports the two)
- Modify: `apps/api/src/app.ts` (remove `requestLogSerializers`; import it from the module)
- Test: `apps/api/test/logging.test.ts` (rewritten)

**Interfaces:**

- Produces:
  - `safeErrorFields(error: unknown): { type: string; message?: string; stack?: string; code?: string }`
  - `requestLogSerializers: { req(request: { method: string; url: string }): { method: string; url: string }; err(error: unknown): ReturnType<typeof safeErrorFields> }`
  - `SEVERITY: Record<'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal', 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL'>`
  - `loggerOptions(): FastifyLoggerOptions & { messageKey: 'message' }` (no stream; `app.ts`
    adds `stream` for tests)

- [ ] **Step 1: Write the failing tests** in `test/logging.test.ts`. Keep the two existing cases
      (they now build Fastify with `loggerOptions()` plus the stream, and log
      `request.log.info({ req: request }, 'seen')` from the route, since Task 2 turns Fastify's own
      request lines off). Add:

```ts
it('writes severity beside the numeric level, message and an ISO time', async () => {
  const line = JSON.parse(await logOne((log) => log.warn({ type: 'x' }, 'careful')));
  expect(line).toMatchObject({ severity: 'WARNING', level: 40, message: 'careful' });
  expect(line.msg).toBeUndefined();
  expect(new Date(line.time).toISOString()).toBe(line.time);
});

it.each([
  ['trace', 'DEBUG'],
  ['debug', 'DEBUG'],
  ['info', 'INFO'],
  ['warn', 'WARNING'],
  ['error', 'ERROR'],
  ['fatal', 'CRITICAL'],
] as const)('maps %s to %s', (label, severity) => expect(SEVERITY[label]).toBe(severity));

it('keeps name, message, stack and code of an ordinary error, nothing else', () => {
  const error = Object.assign(new Error('boom'), { code: 'E_X', secret: 'leak' });
  expect(safeErrorFields(error)).toEqual({
    type: 'Error',
    message: 'boom',
    stack: error.stack,
    code: 'E_X',
  });
});

it('drops the message, query and params of a failed Drizzle query', () => {
  const cause = Object.assign(new Error('invalid input syntax for type uuid: "my note"'), {
    code: '22P02',
  });
  const error = new DrizzleQueryError('select * from notes where id = $1', ['my note'], cause);
  const fields = safeErrorFields(error);
  expect(JSON.stringify(fields)).not.toMatch(/my note|select|params/);
  expect(fields).toMatchObject({ type: 'DrizzleQueryError', code: '22P02' });
  expect(fields.stack?.split('\n')[0]).toBe('DrizzleQueryError');
});

it('drops the message of a Postgres error', () => {
  const error = new postgres.PostgresError({ message: 'value "secret" too long', code: '22001' });
  expect(safeErrorFields(error)).toMatchObject({ type: 'PostgresError', code: '22001' });
  expect(JSON.stringify(safeErrorFields(error))).not.toContain('secret');
});

it.each([
  ['a string', 'oops'],
  ['null', null],
  ['an object', { reason: 'x' }],
])('survives %s thrown', (_label, thrown) => expect(() => safeErrorFields(thrown)).not.toThrow());
```

`logOne` is a local helper: Fastify with `{ ...loggerOptions(), stream }`, run the callback on
`app.log`, return the line.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run test/logging.test.ts`
Expected: FAIL, `Cannot find module '../src/lib/logging/index.js'`.

- [ ] **Step 3: Implement the module.**
  - `safeErrorFields`: `type` is `constructor.name` (DrizzleQueryError sets no `name`), falling
    back to `name`, then `typeof`. A database error is `instanceof DrizzleQueryError` (from
    `drizzle-orm`) or `instanceof postgres.PostgresError` (from `postgres`), or has one as
    `cause`. For it: no `message`, `code` taken from the error or its `cause` (the same reading
    as `classifyDatabaseError` in `lib/postgres/errors.ts`), and `stack` rebuilt as `type`
    followed only by the stack's `   at` lines, since a stack's first lines repeat the message.
    For anything else: `message` and `stack` as they are, `code` if it is a string.
  - `loggerOptions()`: `messageKey: 'message'`; `timestamp: () => \`,"time":"${new Date().toISOString()}"\``;
`formatters.level: (label, number) => ({ severity: SEVERITY[label], level: number })`;
`serializers: requestLogSerializers`. The `req`serializer is today's`requestLogSerializers.req`from`app.ts`, unchanged. `err`is`safeErrorFields`.

- [ ] **Step 4: Run the tests and see them pass**

Run: `pnpm vitest run test/logging.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/logging apps/api/src/app.ts apps/api/test/logging.test.ts
git commit -m "feat(api): one logging module — Cloud Logging severity, message and time; safe error fields"
```

### Task 2: the app uses it, with the request's trace and no duplicate request lines

**Files:**

- Modify: `apps/api/src/app.ts` (`buildApp`'s Fastify options)
- Modify: `apps/api/src/env.ts` (`envSchema`: optional `GOOGLE_CLOUD_PROJECT`)
- Modify: `apps/api/src/lib/logging/options.ts` (add `traceBindings`)
- Modify: `scripts/resolve-release-image.mjs` (`apiConfig` gains `GOOGLE_CLOUD_PROJECT: env.GCP_PROJECT_ID`)
- Modify: `apps/api/test/account-deletion.test.ts` (reads `l.message`, not `l.msg`)
- Test: `apps/api/test/logging.test.ts`, `scripts/resolve-release-image.test.mjs`

**Interfaces:**

- Consumes: `loggerOptions()`, `requestLogSerializers` (Task 1).
- Produces: `traceBindings(header: string | string[] | undefined, projectId: string | undefined): { 'logging.googleapis.com/trace'?: string }`

- [ ] **Step 1: Write the failing tests.** In `test/logging.test.ts`, through `buildTestApp`'s
      `logLines` (it builds the real app):

```ts
it('binds the Cloud Run trace and the redacted request to every line of a request', async () => {
  vi.stubEnv('GOOGLE_CLOUD_PROJECT', 'wally-test');
  // a request to /health with the database stubbed to fail, so the route logs one line
  const line = /* the health.database line */;
  expect(line['logging.googleapis.com/trace']).toBe('projects/wally-test/traces/105445aa7843bc8bf206b12000100000');
  expect(line.req).toEqual({ method: 'GET', url: '/health' });
});

it.each([undefined, '', 'garbage', '/1;o=1'])('omits the trace for header %j', (header) =>
  expect(traceBindings(header, 'wally-test')).toEqual({}));

it('omits the trace without a project', () =>
  expect(traceBindings('105445aa7843bc8bf206b12000100000/1;o=1', undefined)).toEqual({}));

it('writes no per-request "incoming request" or "request completed" lines', async () => {
  // GET /health through buildTestApp with logLines
  expect(lines.join('')).not.toMatch(/incoming request|request completed/);
});
```

The request sends `x-cloud-trace-context: 105445aa7843bc8bf206b12000100000/1;o=1`. In
`scripts/resolve-release-image.test.mjs`: `apiConfig` returns `GOOGLE_CLOUD_PROJECT` equal to
`GCP_PROJECT_ID`.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run test/logging.test.ts` and `node --test scripts/resolve-release-image.test.mjs` (from the repo root)
Expected: FAIL (no trace field; request lines present; no `GOOGLE_CLOUD_PROJECT`).

- [ ] **Step 3: Implement.**
  - `traceBindings`: the trace id is the part before `/`, accepted only if it is 32 hex
    characters; otherwise `{}`.
  - `buildApp`: the logger is `{ ...loggerOptions(), stream }` or `loggerOptions()` where it was
    `{ serializers: requestLogSerializers, ... }` before, so tests still pass `logStream`;
    `logController: new LogController({ disableRequestLogging: true })` (Fastify's replacement
    for the deprecated `disableRequestLogging`, Server reference, "logController");
    `childLoggerFactory(logger, bindings, opts, rawReq)` returns
    `logger.child({ ...bindings, ...traceBindings(rawReq.headers['x-cloud-trace-context'], env.GOOGLE_CLOUD_PROJECT), req: { method: rawReq.method, url: rawReq.url } }, opts)`.
    The `req` serializer redacts it.
  - `envSchema`: `GOOGLE_CLOUD_PROJECT: z.string().min(1).optional()`.
  - `account-deletion.test.ts`: `.find((l) => l.message === 'account erase failed')`.

- [ ] **Step 4: Run the tests and see them pass**

Run: `pnpm vitest run test/logging.test.ts test/account-deletion.test.ts test/health.test.ts`, and the script test
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/app.ts apps/api/src/env.ts apps/api/src/lib/logging scripts/resolve-release-image.mjs scripts/resolve-release-image.test.mjs apps/api/test
git commit -m "feat(api): request lines carry the Cloud Run trace; Fastify's duplicate request lines off"
```

### Task 3: the logging rule where it is broken today

**Files:**

- Modify: `apps/api/src/app.ts` (the `setErrorHandler` callback)
- Modify: `apps/api/src/routes/health.ts`
- Modify: `apps/api/src/lib/commands/index.ts` (`CommandLogger` gains `error`; the inline cleanup's `catch`)
- Test: `apps/api/test/errors.test.ts`, `apps/api/test/health.test.ts`, `apps/api/test/boards-lifecycle.test.ts`

**Interfaces:**

- Consumes: `requestLogSerializers.err` (Task 1) through `request.log`.
- Produces: `CommandLogger { info; warn; error(fields: Record<string, unknown>, message?: string): void }`.
  pino's logger already satisfies it; every caller passes `request.log`.

- [ ] **Step 1: Write the failing tests**, reading lines through `buildTestApp({ logLines })`:

Each case goes through a real route, since `buildTestApp` cannot add routes: a 500 from
`vi.spyOn(ctx.db, 'transaction').mockRejectedValue(new Error('kaboom'))` on a board PATCH (as
`account-deletion.test.ts` does); an `AppError` 500 from `ASSISTANT_MODEL` stubbed to a model with
no price, on a capture; a 502 from a suggestion runner that rejects; a 503 from `/mcp` with MCP
disabled; a 504 from a runner slower than `assistantDeadlineMs`.

```ts
// errors.test.ts
it('logs an unexpected 500 at error with its stack', async () => {
  // a board PATCH while db.transaction rejects with new Error('kaboom')
  expect(line).toMatchObject({
    severity: 'ERROR',
    message: 'Request failed',
    err: { type: 'Error', message: 'kaboom' },
    error: 'INTERNAL_SERVER_ERROR',
  });
  expect(line.err.stack).toContain('kaboom');
});
it(
  'logs an AppError 500 at error' /* AppError(500, 'ASSISTANT_PRICE_MISSING', …) → severity ERROR */,
);
it.each([502, 503, 504])('logs an AppError %i at warn, without a stack', (status) => {
  expect(line).toMatchObject({ severity: 'WARNING', message: 'Request failed', status });
  expect(line.err).toBeUndefined();
});

// health.test.ts
it('logs an unreachable database at warn' /* severity WARNING, type 'health.database', err.type */);

// boards-lifecycle.test.ts
it(
  'logs a failed inline cleanup at error and still answers 200' /* drainCleanupJob rejects
  (vi.spyOn on the maintenance module) → response 200, a line with severity ERROR,
  outcome 'cleanup_pending', cleanupId, err.type */,
);
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run test/errors.test.ts test/health.test.ts test/boards-lifecycle.test.ts`
Expected: FAIL (500 logged without `err`; 5xx `AppError` at error; health at error; cleanup at warn).

- [ ] **Step 3: Implement.**
  - Error handler, for `status >= 500`: if `err instanceof AppError && err.statusCode !== 500`,
    `request.log.warn({ code: body.error, status }, 'Request failed')`; otherwise
    `request.log.error({ err, error: body.error }, 'Request failed')`. The 4xx branch for
    `/assistant/` is unchanged.
  - `health.ts`: `request.log.warn({ type: 'health.database', err: error })`.
  - Inline cleanup `catch (error)`: `options.logger?.error({ err: error, command, operationId, cleanupId, outcome: 'cleanup_pending' }, 'Board cleanup failed')`.

- [ ] **Step 4: Run the tests and see them pass**

Run: the same command
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src apps/api/test
git commit -m "fix(api): unexpected failures log at error with their stack, expected 5xx at warn"
```

### Task 4: the assistant tells Wally's own failures from the provider's

**Files:**

- Create: `apps/api/src/lib/assistant/ownErrors.ts` (moved from `turn.ts`)
- Modify: `apps/api/src/lib/assistant/turn.ts` (imports `own`, `isOwn`)
- Modify: `apps/api/src/lib/assistant/meteredCall.ts`
- Test: `apps/api/test/assistant-suggestions.test.ts`, `apps/api/test/assistant-tidies.test.ts`

**Interfaces:**

- Produces: `own(error: unknown): unknown` (marks and returns it), `isOwn(error: unknown): boolean`.
  This is `turn.ts`'s existing `ownErrors` WeakSet pattern, moved so both callers share it.

- [ ] **Step 1: Write the failing tests.** For a capture and a tidy: make the ledger fail
      (`vi.spyOn` on `trackAttempts`' `reserve` to reject with `new Error('ledger down')`). Expected:
      status 500 (not 502), no `assistant.provider_error` line, and one `Request failed` line at
      `ERROR` whose `err.message` is `ledger down`. Keep the existing provider-failure tests: a
      runner that rejects still gives 502 and an `assistant.provider_error` line at `WARNING` with
      name and status only.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run test/assistant-suggestions.test.ts test/assistant-tidies.test.ts`
Expected: FAIL (502 and `assistant.provider_error` for the ledger failure).

- [ ] **Step 3: Implement.** In `runMeteredCall`, wrap the ledger calls inside `onAttempt`
      (`reserve`, and `settle` / `release` in the returned object) with `.catch((error) => { throw own(error); })`,
      as `turn.ts` does; in the outer `catch`, rethrow when `error instanceof AppError || isOwn(error)`
      before the timeout and provider branches. `turn.ts` keeps its behaviour, importing the
      helpers.

- [ ] **Step 4: Run the tests and see them pass**

Run: `pnpm vitest run test/assistant-suggestions.test.ts test/assistant-tidies.test.ts test/assistant-turns.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/assistant apps/api/test
git commit -m "fix(api): a ledger failure in a capture or tidy is Wally's error, not the provider's"
```

### Task 5: docs and the whole suite

**Files:**

- Create: `docs/adr/ADR-0030-structured-logs-and-the-logging-rule.md` (from `docs/adr/ADR-0000` template)
- Modify: `docs/adr/README.md` (index row, In production: not yet)
- Modify: `docs/DEPLOY.md` (Configuration: `GOOGLE_CLOUD_PROJECT`, set by the release from `GCP_PROJECT_ID`;
  a short "Reading the logs" note: filter by `severity`, open a request's lines from Cloud Run's request log)
- Modify: `docs/rfcs/RFC-0012-observability.md` (workstream 1 as built: the `own` pattern,
  `logController`, `GOOGLE_CLOUD_PROJECT`, the Drizzle finding; Sentry trace id moved to workstream 2)
- Modify: `docs/GDPR.md` (GAP-05 note: app log lines carry no IP and no query string; error
  lines carry no database values)

- [ ] **Step 1: Write the ADR** (300–600 words, as the index asks): the decision is the Cloud
      Logging keys, the safe error fields, the rule of §5.2, and Fastify's request lines off; the
      alternative rejected is a logging library or transport (`pino` multi-target, which cannot
      replace `level`, per pino's docs).
- [ ] **Step 2: Update the other docs** as listed.
- [ ] **Step 3: Run everything**

Run: `pnpm turbo run lint typecheck` from the repo root, then `pnpm vitest run` in `apps/api` (with `DATABASE_URL`), then `node --test scripts/*.test.mjs`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add docs
git commit -m "docs: ADR-0030 structured logs and the logging rule; RFC-0012 workstream 1 as built"
```

**E2E:** nothing in the browser changes, so no new Playwright spec; CI's E2E run must stay green.
After release, the proof is in Cloud Logging: one request to `/health` with a stopped database
shows a `WARNING` line grouped under its Cloud Run request.
