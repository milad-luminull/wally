# Sentry for the web app and the API — design

> **Status:** draft for the owner's review, 2026-11-08 (builder check done). Nothing is built.
> This is workstream 2 of [RFC-0012](../../rfcs/RFC-0012-observability.md). Two parts move out
> of it there: session replay goes to workstream 7, and the logger setup it shares (severity,
> trace field, `err` serializer) is built first in workstream 1.

Date: 2026-11-07. A new processor for Wally, so it also gets an ADR (ADR-0029) and changes the
privacy policy and `docs/GDPR.md` in the same PR.

## Intent

Today Wally has no way to hear about a failure before a user reports it:

- `ErrorBoundary` in `apps/web` only calls `console.error`. Its comment says there is "no
  reporting service on this stack".
- The API's error handler (`setErrorHandler` in `apps/api/src/app.ts`) logs a 5xx as
  `Request failed` with a code and a name, but no message and no stack.
- Both Workers have their logs switched off, because request URLs carry share-link tokens
  (ADR-0022, GDPR.md GAP-05).
- The dashboards planned in RFC-0011 §9 (p95, errors) were never built.

Production has no real users yet. The owner wants Sentry in place **before** people arrive, so
errors, slow requests and broken sessions show up in Sentry, and a new error arrives by email,
rather than in a user's message. Slow requests are seen in Sentry; they send no email.

## Owner decisions (2026-11-07)

1. **Apps:** `web` and `api`. `api-proxy` stays out: it only forwards and has almost nothing of
   its own to fail.
2. **Signals:** errors, performance tracing, session replay and logs.
3. **Org:** the existing Sentry org `luminull`, in the EU data region (Frankfurt).
4. **Configuration as code:** projects, keys and alerts are managed in Terraform, like Auth0,
   Cloudflare and Supabase.
5. **Cost:** the free Developer plan, and Wally stays within it. No spend.
6. **Environments:** production only. Local dev, CI and E2E send nothing.
7. **Alerts:** by email.

Added after the builder check, 2026-11-08:

8. **No consent prompt; Sentry stores as little as possible in the browser.** The privacy
   policy's position stays: no banner, because Wally stores only what is strictly necessary
   (§ 25(2) TDDDG, `privacy.html` §9). So Sentry in the browser must add **no** browser
   storage (cookies, `localStorage`, `sessionStorage`, IndexedDB). Replay runs without its
   stored session. If the builder finds that Replay cannot avoid browser storage, Replay is
   dropped from the web app, and the owner is told; errors and tracing stay.
9. **The org is on the Developer plan and holds no other projects,** so Wally has the whole
   quota.

## Goals

1. An unhandled error in the browser or a 5xx in the API reaches Sentry with a readable stack
   trace, the release it came from, and the route it happened on. A new issue sends an email.
2. Page loads, navigation and API requests are traced end to end, from the browser span to the
   Fastify span.
3. A session that hits an error has a replay of the minutes before it, with all text, inputs and
   media hidden.
4. The API's existing pino logs reach Sentry Logs, already redacted.
5. Nothing that leaves Wally contains a share-link token, an Auth0 `code` or `state`, a bearer
   token, a cookie, a request body, an email address or an IP address.
6. The release uploads the web app's source maps to Sentry and does **not** publish them.

## Non-goals

- **No Sentry for `api-proxy`** (owner decision 1).
- **No tunnel.** Sentry's docs recommend a tunnel against ad-blockers
  ([troubleshooting](https://docs.sentry.io/platforms/javascript/guides/react/troubleshooting/)).
  It would mean a new Worker route whose requests count against the 100,000 a day on Workers
  Free (ADR-0022). Losing events from users with ad-blockers is acceptable for now. _My call._
- **No browser logs.** The web app has no logger today. Logs come from the API only. _My call._
- **No profiling, crons or uptime monitors.** Profiling is not on the Developer plan; crons and
  uptime are out of scope.
- **No CSP work.** Wally has no CSP today (no header in either Worker, `public/_headers` or
  `index.html`), so nothing needs loosening. If a CSP is added later it needs
  `worker-src 'self' blob:` for Replay
  ([session replay](https://docs.sentry.io/platforms/javascript/guides/react/session-replay/)).
- **No dashboards** beyond what Sentry shows by default.

## Anti-goals

This fails, even if events arrive, if:

- a share-link token, an Auth0 `code`, a bearer token or a note's text is visible anywhere in
  Sentry: an error, a breadcrumb, a span, a log line, a transaction name or a replay;
- any event is sent before the DPA is signed (see Constraints);
- Sentry ever bills, or the web app starts serving `.map` files publicly;
- local dev, CI or the E2E suite send events or use up the quota;
- the app breaks or slows down when Sentry is unreachable or blocked.

## Constraints

### Legal

- **The DPA must be signed first.** Sentry's Terms s.4.4: "Unless Customer and Sentry have
  entered into a DPA, Customer will not submit any Personal Data to the Service"
  ([terms](https://sentry.io/terms/)). The DPA is not automatic: it is signed under the org's
  Legal & Compliance settings, by an Owner or Billing member, on all plans
  ([help centre](https://www.sentry.help/en/articles/13965008-how-do-i-sign-your-data-processing-addendum)).
  The [DPA](https://sentry.io/legal/dpa/) makes Sentry a processor and uses the EU–US Data
  Privacy Framework first, with SCCs as the fallback.
- **Some data stays in the US even for an EU org:** user accounts, org settings, teams, tokens,
  DSN keys, project metadata and audit logs
  ([data storage location](https://docs.sentry.io/organization/data-storage-location/)). Event
  data stays in Frankfurt. The privacy policy says both.
- Sentry's [subprocessors](https://sentry.io/legal/subprocessors/) include AWS, Google Cloud,
  Cloudflare, Anthropic, OpenAI and Intercom.

### The free plan

From [pricing](https://sentry.io/pricing/) and [pricing docs](https://docs.sentry.io/pricing/):

- 1 user, 5,000 errors, 5M spans, 50 replays, 1 GB attachments and 5 GB logs, with a 30-day
  lookback.
- Over-quota events "will be dropped and you won't be charged for it". Pay-as-you-go "is only
  available on paid plans" ([quotas](https://docs.sentry.io/pricing/quotas/manage-cron-monitors/)).
  So **the plan itself makes spending impossible**. The real risk is losing monitoring for the
  rest of the month, which the sample rates below guard against.

### SDK version 11 collects more by default

The JavaScript SDKs are on major version 11 (`@sentry/react`, `@sentry/node`;
[releases](https://github.com/getsentry/sentry-javascript/releases)). The
[v10 → v11 migration guide](https://docs.sentry.io/platforms/javascript/migration/v10-to-v11/)
matters here:

- `sendDefaultPii` and `enableLogs` are removed. Logs are on by default.
- `dataCollection` replaces `sendDefaultPii`, and "an unset `dataCollection` collects
  everything by default": user info, cookies, headers, request bodies and query strings
  ([options](https://docs.sentry.io/platforms/javascript/guides/react/configuration/options/#dataCollection)).
- Spans stream by default, so `beforeSendTransaction` no longer runs. `beforeSendSpan` does.
- On Node, the IP address, cookies, the full URL with its query string, incoming request bodies
  and local variables are sent by default
  ([data collected](https://docs.sentry.io/platforms/javascript/guides/fastify/data-management/data-collected/)).

So every option that limits data is set explicitly. Nothing relies on a default, except the
Replay masking defaults, which are already the strict ones.

### Server-side scrubbing is not in Terraform

The Terraform provider has no data-scrubbing or "don't store IP" field. A code search of
`jianyuan/terraform-provider-sentry` for `dataScrubber` returns nothing. These settings are set
by the owner in Sentry's UI and listed in DEPLOY.md under "What stays outside" Terraform.
Sentry's [server-side scrubbing](https://docs.sentry.io/security-legal-pii/scrubbing/server-side-scrubbing/)
is on by default for keys like `password`, `token` and `auth`. It is a second net only; the SDK
config below is the first.

### Credentials

The repo's rule (ADR-0022, DEPLOY.md) is one narrowly scoped credential per job, held as a
GitHub environment secret, with its rotation recorded in DEPLOY.md. This adds two:

| Secret              | Environment      | Used by                      | Scope                                                                                                                    |
| ------------------- | ---------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `SENTRY_AUTH_TOKEN` | `infrastructure` | Terraform                    | `project:write`, `team:write`, `org:read` ([permissions](https://docs.sentry.io/api/permissions/))                       |
| `SENTRY_AUTH_TOKEN` | `production`     | release, web build step only | Organization token (source-map upload; its scopes are fixed, [auth tokens](https://docs.sentry.io/account/auth-tokens/)) |

The provider's docs recommend an internal-integration token. Whether internal integrations exist
on the Developer plan is **unverified**. If they don't, the owner creates a personal token with
the scopes above.

The DSN is public by design. It goes in as a GitHub variable and a Cloud Run env var, not as a
secret.

## Decided

### Part 0: how Sentry sits in the code

The aim is that feature code never knows Sentry exists. Almost everything Sentry reports, it
picks up by itself, through the SDKs' integrations: unhandled errors, React render errors,
Fastify requests, `fetch` calls, navigation and pino logs. In v11 the Node SDK also turns on,
by default, `postgresJsIntegration` (database spans), `vercelAIIntegration` (model-call spans,
through the `ai:telemetry` diagnostics channel, so with `ai` 7 no per-call flag is needed) and
`mcpServerIntegration` (MCP spans, and its own error capture)
(`packages/server-utils/src/integrations/index.ts` at tag 11.11.0). All three stay: the
timings are useful, and `dataCollection` keeps query values, prompts and MCP arguments out. Wally's own code adds only what
the integrations cannot know: init options, data rules, and the signed-in user's id.

**One folder per app is the only place that imports `@sentry/*`:**

| App        | Boundary                 | Exempt besides it                          |
| ---------- | ------------------------ | ------------------------------------------ |
| `apps/api` | `src/lib/observability/` | none: the `--import` entry lives inside it |
| `apps/web` | `src/lib/observability/` | `vite.config.ts` (the build plugin)        |

This is ADR-0013's pattern for the model library, applied a second time. The base ESLint
config (`packages/config/eslint.config.base.js`) gains `SENTRY_PATTERNS` and `SENTRY_SYNTAX`
next to `MODEL_LIBRARY_PATTERNS` and `MODEL_LIBRARY_SYNTAX`, so a stray
`import * as Sentry from '@sentry/react'` anywhere else fails lint in CI. Each boundary turns
off only its own pattern. A flat-config override replaces a rule's options, so without help
every boundary would have to repeat every other boundary's patterns. The base config exports
one helper, `boundaryRules({ except })`, that builds both rules for a folder; `apps/api` uses it
for the model folder too, instead of turning the rules off there.

**What each boundary exports, and nothing else:**

- `apps/api/src/lib/observability/`:
  - `instrument.ts`: the `--import` entry. It imports only `@sentry/node`, `env.ts` and the
    options module, never the plugin, so nothing else loads before Sentry.
  - `sentryOptions(env)`: a pure function returning the `Sentry.init` options. It is unit
    tested directly, with no network.
  - `observability`: a Fastify plugin that `app.ts` registers with one line. It declares
    `dependencies: ['auth-plugin']` (fastify-plugin), so it always runs after auth, whatever the
    registration order. It owns every request-time behaviour: setting the user id once
    `request.user` exists, waiting for Sentry before a reply leaves when this request captured
    an event (`onSend`), and flushing on shutdown (`onClose`). So the auth plugin, the routes
    and `server.ts` stay untouched.
  - `TRACE_HEADERS` (`sentry-trace`, `baggage`): the CORS config in `app.ts` spreads it into
    `allowedHeaders`, so CORS cannot drift from what the browser sends.
- `apps/web/src/lib/observability/`:
  - `initObservability()`: called first in `main.tsx`.
  - `rootErrorHandlers`: passed as `createRoot`'s second argument in `main.tsx`. Without a DSN
    it is `{}`, so React's own console reporting stays in local dev.
  - `ObservedRoutes`: `wrapReactRouterRouting(Routes)`, paired with
    `reactRouterBrowserTracingIntegration`. These are the router-version-neutral names; the
    `…V7…` ones are deprecated in 11.11 (`reactrouter.compat.tsx`). `App.tsx` swaps one
    identifier.
  - `setObservedUser(id)`: called once, where `/me` resolves. Sign-out needs nothing: it leaves
    the page through Auth0's logout, which resets the SDK.
  - `reportUnexpected(error)`: called from the `QueryCache` and `MutationCache` `onError` in
    `lib/queryClient.ts`, for failures that are not an `ApiError`. An `ApiError` is either an
    expected 4xx or a 5xx the API has already reported. Without this, a bug inside a query or
    mutation is swallowed by TanStack Query and never reaches Sentry.

**Reporting a handled error is a log call, not a Sentry call.** Sentry's `pinoIntegration`
turns pino calls at the levels in `error.levels` into Sentry issues, and sends the levels in
`log.levels` as logs ([pino](https://docs.sentry.io/platforms/javascript/guides/fastify/configuration/integrations/pino/)).
With `error.levels: ['error']`, the API's one rule is: _an unexpected failure is logged at
`error` with `err`; an expected one at `warn` or below._ The integration subscribes to pino's
`pino_asJson` tracing channel, so it sees Fastify's own logger (pino 10.4 in the repo), and it
captures the raw `err`, so the stack and the request's trace are kept (source at tag 11.11.0).
`routes/me.ts` already follows the rule on a failed Auth0 deletion and starts reporting with no
change. Three places change, each a logging fix worth having anyway:

- the error handler logs a 5xx that is not an `AppError` at `error` with `err`, so its stack is
  no longer lost. An `AppError` 5xx (`MCP_DISABLED`, the `ASSISTANT_*` 502/504s) is an expected
  state and logs at `warn`. `errorBody.ts` already tells the two apart;
- pino gets an `err` serializer keeping only `name`, `message`, `stack` and `code`. Without it,
  enumerable fields such as a Postgres error's `detail` (`Key (email)=(…)`) would reach Cloud
  Logging and Sentry Logs;
- `routes/health.ts` logs a database failure at `warn`. At `error` it would open an issue with
  no message and no stack on every probe during an outage.

Fastify's own error capture is switched off (`shouldHandleError: () => false`), so a 5xx is
reported once, through the log, not twice.

**MCP tools** are reported by `mcpServerIntegration`, which captures tool, timeout and
validation errors itself. `routes/mcp.ts` therefore does not change. The integration test drives
a real MCP call and holds the rule _one event per unexpected failure, none for an expected one_.
If the integration reports expected `AppError` results or model-caused validation errors, its
capture is filtered in `scrub` by the integration's mechanism, and the tool handler logs only
unexpected failures at `error` instead.

**No DSN means nothing happens.** Both `init` calls return early without a DSN. Local dev,
unit tests, CI and E2E need no mocks, flags or stubs, and feature tests never see Sentry.

**Only `apps/api/src/server.ts` is instrumented.** The image's command loads `instrument.ts`
with `--import` for the server only; `maintenance.ts`, `migrate-cli.ts` and the seed scripts are
never instrumented.

**Updates move together.** `.github/dependabot.yml` gets a `sentry` group (`@sentry/*`),
listed **before** the existing groups, since Dependabot puts a dependency in the first group it
matches. The React SDK, the Node SDK and the Vite plugin then update in one PR (the plugin has
its own version numbers, so one PR, not one version). Majors stay ignored, as for every package
today; a Sentry major is a deliberate migration.

**Changes to existing files, in full:**

| File                                        | Change                                                                                                                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/app.ts`                       | register `observability`; spread `TRACE_HEADERS` into CORS; unexpected 5xx logs at `error` with `err`, `AppError` 5xx at `warn`; an `err` serializer; the request-log serializer uses `redactUrl` |
| `apps/api/src/routes/health.ts`             | the database-failure log moves to `warn`                                                                                                                                                          |
| `apps/api/src/env.ts`                       | optional `SENTRY_DSN` and `SENTRY_RELEASE`                                                                                                                                                        |
| `apps/api/Dockerfile`                       | the prod command adds `--import ./dist/lib/observability/instrument.js`                                                                                                                           |
| `apps/web/src/main.tsx`                     | `initObservability()` first; `rootErrorHandlers` into `createRoot`                                                                                                                                |
| `apps/web/src/App.tsx`                      | `Routes` becomes `ObservedRoutes`                                                                                                                                                                 |
| where `/me` resolves                        | `setObservedUser(uid)`                                                                                                                                                                            |
| `apps/web/src/lib/queryClient.ts`           | `reportUnexpected` in the cache `onError` hooks                                                                                                                                                   |
| `apps/web/src/components/ErrorBoundary.tsx` | the "no reporting service" comment goes; nothing else                                                                                                                                             |
| `apps/web/vite.config.ts`                   | the Sentry plugin and hidden source maps, only when the upload token is set                                                                                                                       |
| `apps/web/src/vite-env.d.ts`                | `VITE_SENTRY_DSN`                                                                                                                                                                                 |
| `packages/shared`                           | `redactUrl` and `TOKEN_PATH_PREFIXES`                                                                                                                                                             |
| `packages/config/eslint.config.base.js`     | the Sentry import boundary                                                                                                                                                                        |
| `.github/dependabot.yml`                    | the `sentry` group                                                                                                                                                                                |

No route, component, hook or query changes beyond these.

### Part 1: one URL redactor, shared

`packages/shared` gets `redactUrl(url)` and the list it works from, `TOKEN_PATH_PREFIXES`
(`/share-links/`, `/share/`). The API's request-log serializer (`requestLogSerializers` in
`apps/api/src/app.ts`) switches to it, and so do both observability boundaries. It:

- drops the query string and the fragment (this covers the Auth0 callback
  `/login?code=&state=`, the board search `q`, and everything else in a query);
- replaces the segment after each prefix with `[redacted]`.

`apps/api/test/logging.test.ts` keeps passing unchanged; `redactUrl` gets its own unit tests
for each URL shape above, including full URLs with a host.

**So that a new secret in a URL is never missed,** two guard tests work from an allow-list,
not from a parameter name. Every route parameter must either be listed as not secret
(`boardId`, …) or sit behind a prefix in `TOKEN_PATH_PREFIXES`. A new `:code` or `:inviteKey`
fails the test until someone decides which it is.

- API: the test collects every registered route through Fastify's `onRoute` hook.
- Web: the test reads every `path=` under `apps/web/src`, as `englishIdentifiers.test.ts` and
  `brandGuards.test.ts` already read sources.

### Part 2: the web app (`apps/web`)

- **Package:** `@sentry/react` 11.x, an exact version. Peer dependencies cover React 19 and
  react-router 8 (`packages/react/package.json` in getsentry/sentry-javascript).
- **Init options** (in the boundary):
  - `enabled` only with a DSN; `environment: 'production'`; `release` injected by the build
    plugin (Part 4).
  - `dataCollection`, every field set to collect nothing optional: `userInfo`, `cookies`,
    `httpHeaders`, `httpBodies`, `urlQueryParams`, `graphQL`, `genAI`, `mcp`,
    `databaseQueryData`, `queues`, `stackFrameVariables` and `frameContextLines`
    (`packages/core/src/types/datacollection.ts` at 11.11.0;
    [options](https://docs.sentry.io/platforms/javascript/guides/react/configuration/options/#dataCollection)).
    The object is shared by both apps and typed
    `satisfies Required<NonNullable<…['dataCollection']>>`, so a field that a future minor
    release adds, defaulting to collecting, fails typecheck instead of collecting silently.
    `frameContextLines` stays at its default of 5: it is Wally's own source code, not user data.
  - One `scrub` function, built on `redactUrl`, is the body of `beforeSend`,
    `beforeBreadcrumb` and `beforeSendSpan`, so every URL field goes through the same code.
  - `allowUrls` limited to Wally's own origin, so errors thrown by browser extensions and
    third-party scripts are not reported. `ignoreErrors` starts empty and grows only from real
    noise.
  - **Tracing:** `browserTracingIntegration` through the react-router integration
    ([React Router](https://docs.sentry.io/platforms/javascript/guides/react/features/react-router/)),
    so transaction names are route patterns (`/share/:token`), never real paths.
    `tracesSampleRate: 0.2`. `linkPreviousTrace: 'in-memory'` is set explicitly, though it
    is the default, because the other values write to `sessionStorage` (owner decision 8).
  - `tracePropagationTargets` limited to the API origin from `VITE_API_BASE_URL`. By default
    the browser only propagates to its own origin, which would miss the API.
  - **Replay:** `replayIntegration()` with `replaysSessionSampleRate: 0`,
    `replaysOnErrorSampleRate: 1.0` and `stickySession: false`. Sentry's agent-plugin
    reference for React (getsentry, `skills/sentry-instrument/references/sdks/react/session-replay.md`)
    says `stickySession` "uses `sessionStorage`" and defaults to `true`; turning it off keeps
    owner decision 8. The builder confirms it on the configuration page.
    Defaults kept: `maskAllText`, `maskAllInputs` and `blockAllMedia` are all `true`, and
    `networkDetailAllowUrls` is `[]`, so no request or response bodies
    ([configuration](https://docs.sentry.io/platforms/javascript/session-replay/configuration/),
    [privacy](https://docs.sentry.io/platforms/javascript/session-replay/privacy/)).
- **No browser storage at all** (owner decision 8). A test, with a test DSN pointed at a local
  stub, asserts that after init, an error and a replay buffer, `document.cookie`,
  `localStorage`, `sessionStorage` and IndexedDB hold nothing new from Sentry.
- **User:** the Wally user id only, no email and no name. _My call:_ it
  lets Sentry count affected users.
- **Error capture:** React 19's root error hooks (`onUncaughtError`, `onCaughtError`,
  `onRecoverableError`) get `Sentry.reactErrorHandler()`
  ([error boundary](https://docs.sentry.io/platforms/javascript/guides/react/features/error-boundary/)).
  This also reports errors that Wally's existing `ErrorBoundary` catches, so the component
  keeps its fallback UI and needs no Sentry code.

### Part 3: the API (`apps/api`)

- **Package:** `@sentry/node` 11.x, an exact version. Node 22.23 is inside its engines.
- **Init:** `src/lib/observability/instrument.ts` calls `Sentry.init` with
  `sentryOptions(loadEnv())`. The production command becomes
  `node --import ./dist/lib/observability/instrument.js dist/server.js`, as Sentry requires for ESM
  ([Fastify guide](https://docs.sentry.io/platforms/javascript/guides/fastify/)). Reading the
  env through `loadEnv()` keeps one schema; it caches, so `server.ts` gets the same result.
- **Init options** (`sentryOptions`):
  - `environment: 'production'`, `release: SENTRY_RELEASE`.
  - The shared `dataCollection` (Part 2). On the API it matters most: `stackFrameVariables`
    off, since local variables can hold note text; `genAI` off, since model calls **are**
    traced by default in v11 and their prompts are users' notes; `mcp` off for tool arguments
    and results; `databaseQueryData` off for query values. A test asserts that a traced model
    call and a traced MCP call carry no inputs or outputs.
  - One `scrub` function, built on `redactUrl`, is the body of `beforeSend`, `beforeSendSpan`
    and `beforeSendLog`. As a second net it deletes `request.headers`, `request.cookies`,
    `request.data` and `user.ip_address`.
  - `tracesSampleRate: 0.2`. `/health` is never traced.
  - `pinoIntegration({ error: { levels: ['error'] }, log: { levels: ['info', 'warn', 'error', 'fatal'] } })`
    and `fastifyIntegration({ shouldHandleError: () => false })` (Part 0).
- **Errors:** through the log, and MCP through its integration (Part 0).
- **Cloud Run and sending:** Cloud Run throttles the CPU outside requests and scales to zero,
  so a background send can stall or be lost. The `observability` plugin waits up to 500 ms for
  Sentry before a reply leaves, **only** when that request captured an event, and flushes on
  shutdown. If Sentry is unreachable, only failing requests wait, and never more than 500 ms. Neither costs money. Spans and logs
  from ordinary requests may still arrive late or occasionally be lost; always-on CPU or a
  minimum instance would fix that, but costs money.

### Part 4: the release

- **One release name:** `wally@<semver>` from the tag (`GITHUB_REF_NAME` without the `v`),
  for both apps.
- **Web build step:** gets `VITE_SENTRY_DSN` (a GitHub variable) and `SENTRY_AUTH_TOKEN`.
  `vite.config.ts` adds the Sentry Vite plugin only when the token is set.
  - `build.sourcemap: 'hidden'` and `sourcemaps.filesToDeleteAfterUpload`, so no `.map` file
    reaches the Worker ([Vite source maps](https://docs.sentry.io/platforms/javascript/guides/react/sourcemaps/uploading/vite/)).
  - `org: 'luminull'`, the web project, `release.name` as above, and `url: 'https://de.sentry.io/'`.
    Whether an EU org needs that `url` is **unverified**; a wrong value fails the upload loudly.
  - The bundle keeps its `assets/index-*.js` name, which the smoke test greps.
- **The bundle check** in the release (after the web build) also fails if the bundle has no
  `ingest.de.sentry.io` DSN, or if any `.map` file is in `dist`.
- **Cloud Run:** `apiConfig` in `scripts/resolve-release-image.mjs` gains `SENTRY_DSN` and
  `SENTRY_RELEASE`. It replaces the whole env set and `verify` asserts an exact match, so both
  are added there and nowhere else.
  - **Both values contain `@`** (`https://<key>@o….ingest.de.sentry.io/…` and `wally@<semver>`),
    which is today's gcloud delimiter (`^@^`). The script rejects any value containing it, on
    purpose, so that no value can silently split. The delimiter moves to a character no value
    can contain (for example `^|^`), and the guard moves with it, still rejecting newlines and
    the new delimiter. Its unit tests cover both new values.
- **A failed source-map upload fails the release.** The Vite plugin only warns by default; its
  error handler is set to throw. Unreadable stack traces would defeat Goal 1. _My call._ If
  Sentry is down during an urgent fix, DEPLOY.md says how to release without the upload (leave
  the production `SENTRY_AUTH_TOKEN` out of that one run).

### Part 5: Terraform (`infra/terraform/wally/sentry.tf`)

- **Provider:** `jianyuan/sentry` `~> 0.15.8` ([registry](https://registry.terraform.io/providers/jianyuan/sentry/latest/docs)).
  The registry marks it "community"; its docs call it the official provider, maintained with
  Sentry's sponsorship. `base_url = "https://de.sentry.io/api/"`, per the maintainer in
  [issue 414](https://github.com/jianyuan/terraform-provider-sentry/issues/414) (not in the
  provider docs). The token comes from `SENTRY_AUTH_TOKEN`, set by `infrastructure.yml`.
- **Resources** (new, nothing to import):
  - a team for Wally, unless the org's existing team is used;
  - `sentry_project` `wally-web` (React) and `wally-api` (Node/Fastify), with
    `prevent_destroy`;
  - `sentry_key` for each project; its `dsn` output feeds
  - `github_actions_environment_variable` entries in `github.tf`: `VITE_SENTRY_DSN` and
    `SENTRY_DSN` on the `production` environment.
  - **Alerts:** each project's default rule (`default_rules = true`) emails on a new issue. The
    builder confirms what the default rule does; if it doesn't email on new issues, a
    `sentry_alert` replaces it (`sentry_issue_alert` is deprecated).
- **Not in Terraform** (DEPLOY.md, "What stays outside"): the DPA, the server-side scrubbing
  settings, the two tokens, and the org itself.

### Part 6: privacy and docs (same PR)

- **`apps/web/privacy.html`:**
  - §5 processors table: a Sentry row, "Functional Software, Inc. d/b/a Sentry (USA)" | finds
    errors and slow requests, records hidden-text replays of sessions that hit an error | event
    data in Frankfurt (EU), account data in the US.
  - §7 transfers: Sentry under the DPF, with SCCs as the fallback.
  - §8 retention: Sentry events, 30 days on the plan Wally uses.
  - §9 browser storage: unchanged in substance. It gains one sentence saying Sentry stores
    nothing in the browser, which the storage check in Part 2 pins.
  - The date line.
- **`apps/web/src/legal/legalPages.test.ts`:** adds `Sentry` to the processor list.
- **`docs/GDPR.md`:** §1 processor row; §3 "No processors beyond…" rewritten, since its claim of
  "no error reporter or session recorder" stops being true; the retention entry; GAP-05 notes
  that Sentry gets only redacted URLs.
- **ADR-0029** "Sentry for errors, tracing, replay and logs", and the ADR index. It records the
  import boundary (Part 0) as ADR-0013 does for the model library, and the rule "report a
  handled failure by logging it at `error`".
- **`docs/DEPLOY.md`:** a `## Sentry` section with the owner's setup steps (in order: sign the
  DPA, scrubbing settings, create both tokens, store them, apply Terraform) and "Proof after the
  release"; the two secrets in Configuration with their rotation; the Terraform tables.
- **`docs/README.md`** "What production runs today", and the stack lists in `docs/SETUP.md` and
  `docs/architecture/overview.md`.

### Part 7: tests

- **Unit:** `redactUrl` for every token-carrying URL shape; each app's `scrub` given events,
  breadcrumbs, spans and logs that contain a share token, an Auth0 code, a bearer header, a
  cookie, a body and an IP, asserting none survive; `sentryOptions` sets every
  `dataCollection` field; `envSchema` accepts and rejects `SENTRY_DSN`; init is a no-op without
  a DSN.
- **Guards:** the two token-route tests (Part 1); the lint boundary, proven by a lint fixture or
  by the rule's own test in `packages/config`, as for ADR-0013.
- **API integration:** with an in-memory Sentry transport, against a server started with
  `listen({ port: 0 })` and called with real `fetch`. `app.inject()` would skip the HTTP server,
  so there would be no isolation scope and no request span, and the test would pass for the
  wrong reason. It proves: an unexpected 5xx produces exactly one event with a stack trace and a
  redacted URL; an `AppError` 5xx and a 4xx produce none; a real MCP call follows the MCP rule
  (Part 0); a model call and an MCP call carry no inputs or outputs. These tests import
  `@sentry/node`, so they live in the boundary folder.
- **Web:** the browser-storage test (Part 2).
- **E2E (new spec):** across sign-in, a board and a share link, the app makes **no** request to
  any `sentry.io` host, since the E2E stack has no DSN. This pins "production only".
- **Release:** the bundle check above.
- **Proof after the first release** (DEPLOY.md): the owner opens the app once. Sentry then shows
  the `wally@<semver>` release with source maps, a page-load trace joined to its API span, and
  the API's startup log line. Then the owner searches Sentry for `share` and for a known share
  token, and finds nothing.

## Left to the builder

- How the plugin knows a request captured an event (for the conditional flush).
- Whether `mcpServerIntegration` reports expected failures, and the filter if it does.
- Confirming `stickySession: false` stores nothing; if Replay still stores, it is dropped
  (owner decision 8).
- Which Sentry hook covers URLs inside replay recordings. If no hook reaches them, Replay stops
  itself on `/share/:token`, so a share URL can never be recorded.
- Pinning versions: exact versions in 11.x, preferring one at least two weeks old (11.11.0 came
  out on 2026-11-05).
- The team resource, and the alert resource if the default rule doesn't email.

## Risks

- **v11 is new.** Its defaults changed towards collecting more, and Sentry's own pages disagree on
  Fastify 5. The tests in Part 7 are what proves the config, not the docs.
- **Replay and URLs.** Replay records page URLs. The share route is the one that matters; the
  builder note above covers it.
- **Ad-blockers** drop some browser events (no tunnel, by choice).
- **Quota.** A burst of errors can use up the 5,000 errors or 50 replays and leave the rest of
  the month blind. Nothing is billed.
- **US-held metadata.** DSN keys and project metadata are in the US even for an EU org. They
  hold no user data.

## Claude's calls

- `tracesSampleRate: 0.2` on both apps; replays only on error, at 100 %.
- The Wally user id is attached to events; no email, name or IP.
- No tunnel; no browser logs; API logs at `info` and above.
- Local variables are not sent (`stackFrameVariables: false`); AI prompts and outputs are off.
- One shared `redactUrl` replaces the API's inline regex, with guard tests for new token routes.
- `@sentry/*` is imported only in one folder per app, enforced by lint (ADR-0013's pattern).
- Unexpected failures are reported by logging them at `error`; expected ones log at `warn`;
  Fastify's own capture is off; pino's `err` keeps only name, message, stack and code.
- Database, model-call and MCP spans stay on, with their data off; `dataCollection` is typed so
  a new field cannot default to collecting.
- The web reports non-`ApiError` failures from TanStack Query once, in `queryClient.ts`.
- `allowUrls` limits browser errors to Wally's own scripts.
- Dependabot updates all `@sentry/*` packages in one PR.
- Release name `wally@<semver>`.
- MCP tool failures are reported by Sentry's MCP integration, held to the same rule.
- A request that captured an event waits up to 500 ms for Sentry to send; shutdown flushes.
- A failed source-map upload fails the release.
- Only new issues send email; slow requests are visible in Sentry without alerts.
- Both DSNs reach GitHub through Terraform, not by hand.

## Evidence (read 2026-11-07)

Vendor pages, all linked above: Sentry pricing and quotas, data storage location, the v10 → v11
migration guide, the React options, React Router, error boundary, Session Replay configuration
and privacy, the Fastify guide, data collected, pino, server-side scrubbing, Vite source maps,
API permissions and auth tokens, Terms, the DPA and the subprocessor list; the Terraform registry
page and issue 414 of the provider.

### Still not verified first-hand

- Whether internal-integration tokens exist on the Developer plan.
- Whether the Vite plugin needs `url: https://de.sentry.io/` for an EU org.
- The Terraform `base_url` for EU (a maintainer comment, not the provider docs).
- Settled from the SDK source at 11.11.0 (2026-11-08): `pinoIntegration` sees Fastify's logger
  and keeps the stack; `setupFastifyErrorHandler` does nothing in v11; `shouldHandleError` is
  valid; `fastifyIntegration` covers Fastify 3.21 to 6 (the docs page listing 3 and 4 is out of date); the `dataCollection` field names.
- What the project's default alert rule does.
