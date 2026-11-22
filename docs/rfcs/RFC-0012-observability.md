# Observability: Sentry and the platforms' own tools

- **Status:** accepted by the owner on 2026-11-08, after a builder check the same day.
  Workstream 1 is built (§7, "As built"); the others are not.
- **Date:** 2026-11-08
- **Source:** the owner's observability requirements of 2026-11-08 (summarised in §2), and the
  [Sentry design](../superpowers/specs/2026-11-07-sentry-design.md) of 2026-11-07, which becomes
  workstream 2.
- **Decisions to record:** [ADR-0031](../adr/ADR-0031-structured-logs-and-the-logging-rule.md)
  (structured logs and the logging rule, recorded with workstream 1); Sentry as the application
  monitor, behind one import boundary; scheduled checks as a Cloud Run Job. ADR-0029 and
  ADR-0030, the numbers first planned here, went to other decisions, so these two take the next
  free numbers when they are written.
- **Fulfils:** the dashboards and alerts listed in [RFC-0011 §9](RFC-0011-platform-migration.md)
  ("API p95 latency and errors; database size…; AI spend"). Queue age, notification delay and
  Realtime belong to RFC-0011 workstream 5 and follow the rule in §6.

## 1. Outcome

Wally gets a lightweight observability foundation at **$0 extra cost**:

- every unexpected failure in the browser, the API and scheduled work reaches **Sentry** and,
  if it is new, an email;
- logs are structured for **Cloud Logging** and carry the trace that ties them to the Sentry
  event;
- AI calls are measurable for latency, failures, tokens, cost and invalid output, with no
  prompt or reply leaving Wally;
- an outage of the web app or the API raises an alert within minutes;
- a failed or missed scheduled run raises an alert;
- spending and telemetry volume stay inside free tiers by configuration, not by luck.

Feature code stays almost untouched. Sentry is imported in one folder per app (its ADR, §7 workstream 2), and
the API's one reporting rule is a logging rule (§5).

## 2. Requirements (owner, 2026-11-08)

**Principles:** clean code and established patterns; official SDKs and standard conventions; no
hacks, custom monitoring frameworks or duplicate instrumentation; reuse the existing
architecture; no over-engineering; privacy by design (no user content, credentials, prompts or
replies in telemetry); stay inside free tiers. No Grafana, Prometheus, self-hosted or paid
monitoring.

| Area                  | Requirement                                                          | Priority | Workstream        |
| --------------------- | -------------------------------------------------------------------- | -------- | ----------------- |
| Error tracking        | Frontend and backend, release tracking, actionable exceptions        | P0       | 2                 |
| Structured logging    | JSON logs, severity, request correlation                             | P0       | 1                 |
| Background processing | Job failures, retries, missed schedules, reminder delivery           | P0       | 5 (reminders: §6) |
| AI                    | Latency, failures, tokens, estimated cost, fallbacks, invalid output | P0       | 3                 |
| Availability          | Health checks and actionable alerts for critical failures            | P0       | 4                 |
| Cost                  | AI usage, cloud budget alerts, telemetry volume controls             | P0       | 3, 6              |
| UX performance        | Core Web Vitals, critical user journeys                              | P1       | 7                 |
| Product insights      | Lightweight measures of AI effectiveness and core actions            | P1       | 8                 |

## 3. Where Wally is today (checked 2026-11-08)

- **Errors:** no reporting service. The web `ErrorBoundary` only calls `console.error`; the API
  logs a 5xx without its message or stack.
- **Logs:** Fastify's default pino JSON: numeric `level`, `msg`, no `severity`, no trace field,
  request ids `req-N` per instance. Cloud Logging therefore treats every line as `DEFAULT`
  severity and cannot group a request's lines. URLs are already redacted
  (`requestLogSerializers` in `apps/api/src/app.ts`, pinned by `apps/api/test/logging.test.ts`).
- **Silent failures:** when a board deletion's inline cleanup fails (`apps/api/src/lib/commands/index.ts`,
  after a committed command), the error is dropped and only `outcome: 'cleanup_pending'` is
  logged at `warn`; the job waits for someone to run `pnpm maintenance --cleanup` by hand.
  In the AI path, `runMeteredCall` (`lib/assistant/meteredCall.ts`) logs **every** non-`AppError`
  as `assistant.provider_error` at `warn`, so Wally's own bugs there (a ledger or database
  failure, a `TypeError`) look like provider failures. A missing price
  (`AppError(500, 'ASSISTANT_PRICE_MISSING')`, `budget/prices.ts`) is a configuration bug.
- **Scheduled work:** one pg_cron job, `wally-purge-expired`, hourly
  (`apps/api/drizzle/0001_purge_expired.sql`, redefined in `0005_retention.sql`). Each release
  checks that it _exists_ (`assertPurgeScheduled`); nothing checks that it _succeeds_. A GitHub
  workflow (`keepalive.yml`) calls `/health` every six hours so Supabase Free does not pause.
- **Reminders do not exist.** `SPEC.md` §14 lists them as out of scope; RFC-0010 and RFC-0011
  workstream 5 plan the background service, Cloud Scheduler, Cloud Tasks and Resend for them.
- **AI:** already measured inside the app. `model/usage.ts` reads input, cached, output and
  reasoning tokens; `budget/prices.ts` prices them; `budget/ledger.ts` enforces a daily token cap
  per user and a monthly spend cap ($15 by default). Each call logs, without content,
  `assistant.turn`, `assistant.capture` or `assistant.tidy` with usage, `finishReason`, outcome
  and duration, and warnings `assistant.provider_error` and `assistant.timeout`. Invalid
  structured output (`NoObjectGeneratedError`) becomes `null` fields with a `finishReason`, not an
  error. There is no fallback model; tidy moves dated notes by rule and asks the model only about
  the rest.
- **Availability:** `/health` checks the database. No Cloud Run probes, uptime checks, alert
  policies or notification channels exist. The release smoke-tests each deploy.
- **Cost:** `google_billing_budget.wally` (`infra/terraform/bootstrap/main.tf`), alert-only, at
  50, 90 and 100 % of 10 units, to the billing account's default recipients.
- **Privacy:** the policy promises no analytics or tracking tools (`privacy.html` §2) and no
  consent banner, because only strictly necessary data is stored in the browser
  (§9, § 25(2) TDDDG). `docs/GDPR.md` §3 says Wally has "no error reporter or session recorder".

## 4. Who owns which signal

Each signal has exactly one owner, so nothing is instrumented twice.

| Signal                                                 | Owner                                                               | Why                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Errors, traces, Web Vitals, AI spans, app-level alerts | **Sentry** (Developer plan, EU)                                     | The primary application monitor. The free plan includes 5k errors, 5M spans, 5 GB logs, 20 metric monitors, 1 cron monitor and email alerts ([pricing](https://sentry.io/pricing/)). Over quota, events "will be dropped and you won't be charged" ([pricing docs](https://docs.sentry.io/pricing/)). |
| Logs, as the system of record                          | **Cloud Logging**                                                   | Cloud Run already ships stdout there. "First 50 GiB/project/month" free; default 30-day retention costs nothing ([pricing](https://cloud.google.com/products/observability/pricing)). The same lines also reach Sentry Logs through the pino integration (workstream 2), from one logger.             |
| Uptime of the web app and the API                      | **Cloud Monitoring uptime checks**                                  | "1 million executions per Google Cloud project" free; alert policies on uptime metrics "are not charged", even under the alerting prices due "no sooner than September 1, 2027" (same page). Managed in Terraform with the existing `google` provider.                                                |
| Scheduled-run failures and misses                      | **Sentry cron monitor**, fed by an ops-check job (§5, workstream 5) | One cron monitor is free on every plan.                                                                                                                                                                                                                                                               |
| Cloud spend                                            | The **existing billing budget**                                     | Already in Terraform. Alert-only (owner, 2026-11-08).                                                                                                                                                                                                                                                 |
| AI spend                                               | The **app's own ledger**                                            | It already prices every call and enforces the caps; Sentry shows the same cost per call.                                                                                                                                                                                                              |

**Not used, on purpose:**

- **Google Error Reporting** would show the same exceptions as Sentry. It is free and may pick
  up stack traces from logs on its own; its notifications stay off.
- **Cloud Monitoring alerts on app metrics** (5xx rate, latency): Sentry's metric monitors cover
  them, and Google's alerting is due to charge per metric reference from September 2027.
- **Cloudflare Workers Logs:** both Workers keep logging off, because URLs carry share tokens
  (ADR-0022).
- **Supabase log drains and the metrics endpoint** are not on the Free plan
  ([pricing](https://supabase.com/pricing)). The ops check measures the one database number that
  matters, its size (workstream 5).

## 5. Rules that keep it clean

1. **One import boundary per app.** Only `apps/api/src/lib/observability/` and
   `apps/web/src/lib/observability/` import `@sentry/*` (plus `vite.config.ts` for source maps).
   The base ESLint config enforces it, as it does for the model library (ADR-0013).
2. **Feature code reports by logging.** In the API: an unexpected failure is logged at `error`
   with `err`; an expected one at `warn` or below. Sentry's `pinoIntegration` turns `error` logs
   into issues. _Expected_ means a state the code was written to handle: a 4xx, an `AppError`
   with 502, 503 or 504 (provider down, feature disabled, timeout). An `AppError` with 500 is a
   bug, so it logs at `error`. A provider's own error is logged by shape only (name, status,
   code), never its message, as `turn.ts` already does, because a provider's wording can echo
   the prompt. In the web app: React's root error hooks and TanStack Query's cache `onError`
   report unexpected failures in one place each.
3. **No secrets, content or identity in telemetry.** One `redactUrl` (shared) and one `scrub`
   per app cover every URL; every `dataCollection` field is set, typed so a new field cannot
   default to collecting; prompts, replies, MCP arguments, query values, local variables, IPs,
   emails and cookies never leave. Allow-list guard tests catch a new secret in a URL.
4. **Telemetry never breaks the app.** No DSN means no-op. Sends are asynchronous; a request
   waits at most 500 ms, and only when it captured an event.
5. **Free by configuration.** Sample rates, log level and quotas are set in code or Terraform
   and listed in §8; nothing relies on a vendor default to stay free.

## 6. Background work and reminders

Today's scheduled work is the hourly purge. It stays in pg_cron, where it runs next to the
data. What is added is a check that it ran:

- **An ops-check Cloud Run Job**, from the API image (`node dist/ops-check.js`, beside
  `maintenance.ts`), triggered hourly by **Cloud Scheduler**. A Cloud Run Job needs no public
  endpoint and no token checking in the API: Cloud Scheduler starts it through the Cloud Run API
  with its own service account. _My call, refining the owner's choice of "an hourly ops check":_
  an internal HTTP endpoint would need Google-token verification in Fastify and would be
  reachable from the internet.
- It reads, never writes. It connects with its own read-only database role, `wally_ops_check`
  (`SELECT` on `cron.job_run_details` and the tables it counts, plus `pg_database_size`), held
  in its own Secret Manager secret, readable only by the job's service account. The release's
  `wally-database-url` is the table owner and is not reused. The owner creates the role once
  (DEPLOY.md gives the SQL), since its password must not live in a migration.
- It wraps its run in Sentry's cron check-ins (`Sentry.withMonitor`), so Sentry alerts on a
  **missed** run (the scheduler or job did not start) and on a **failed** one. It fails when:
  - the last `wally-purge-expired` run in `cron.job_run_details` failed, or is older than two
    hours;
  - a board cleanup job has been pending for more than a day. The check only detects it;
    draining stays a manual `pnpm maintenance --cleanup`, since an automatic drain is a
    behaviour change, not observability (_my call_);
  - the database cannot be reached.
- It reports the database size as a Sentry gauge, alerted at 80 % of Supabase Free's 500 MB.
- Cost: 1 of the 3 free Cloud Scheduler jobs per billing account, which has none or one in use
  (owner, 2026-11-08) ([pricing](https://cloud.google.com/scheduler/pricing)) and a few seconds of the Cloud Run
  Jobs free tier ([pricing](https://cloud.google.com/run/pricing)).
- Its retries are Cloud Scheduler's; the next hourly run is the retry of last resort.

**Reminders** are not built, so there is nothing to monitor yet. This RFC sets the rule for
RFC-0010 and RFC-0011 workstream 5: every scheduled or queued job reports a check-in or an
`error` log per run, and reminder delivery logs one structured event per send with its outcome.
More cron monitors than the free one need a paid plan, so the background service will report
through the ops check or through its own `error` logs, not one monitor per job.

## 7. Workstreams

Each workstream is one PR, shipped and verified before the next starts (no stacked PRs). Each
gets its own design in `docs/superpowers/specs/` before building.

| #   | Workstream                        | Priority | Depends on |
| --- | --------------------------------- | -------- | ---------- |
| 1   | Logging foundation                | P0       | none       |
| 2   | Sentry errors, tracing and logs   | P0       | 1          |
| 3   | AI observability                  | P0       | 2          |
| 4   | Availability and alerts           | P0       | 2          |
| 5   | Ops check for scheduled work      | P0       | 2          |
| 6   | Cost and volume controls          | P0       | 3, 5       |
| 7   | UX performance and session replay | P1       | 2          |
| 8   | Product insights                  | P1       | 5          |

### Workstream 1: logging foundation

- A `loggerOptions` module in `apps/api/src/lib/logging/` that `app.ts`, the ops check and the
  CLI scripts share:
  - `messageKey: 'message'`, and a `severity` string beside pino's numeric `level`
    (`formatters.level`), as Cloud Logging's
    [structured logging](https://docs.cloud.google.com/logging/docs/structured-logging) expects.
    `level` stays, because Sentry's pino integration reads it; a test pins both.
  - `logging.googleapis.com/trace` built from Cloud Run's `X-Cloud-Trace-Context`, the format of
    Cloud Run's [logging sample](https://docs.cloud.google.com/run/docs/logging), so a request's
    lines group under Cloud Run's own request log. The project id comes from a new
    `GOOGLE_CLOUD_PROJECT` setting, filled by the release. Workstream 2 adds the Sentry trace
    id, read through the observability boundary, to jump between the two.
  - The `err` serializer keeping only `name`, `message`, `stack` and `code`; the request
    serializer using the shared `redactUrl`.
- The logging rule (§5.2) applied where it is broken today:
  - the error handler's 5xx log;
  - `routes/health.ts`, at `warn`;
  - the inline cleanup in `lib/commands/index.ts` logs the failure at `error` with `err`, not
    only `cleanup_pending` at `warn`. The job still waits for a later drain; the ops check
    (workstream 5) alerts if it waits more than a day;
  - `runMeteredCall` separates the provider's failures (`assistant.provider_error`, `warn`,
    shape only, as today) from Wally's own (rethrown, so the error handler logs them at
    `error`). It reuses `turn.ts`'s existing pattern: errors from Wally's own callbacks (the
    ledger) are marked as they are thrown, and anything unmarked came from the provider.
- **Fastify's per-request log lines are turned off** (`LogController` with
  `disableRequestLogging`, Fastify's replacement for the deprecated top-level option). Each request is
  already recorded by Cloud Run's request log and by its Sentry span; sending a third copy to
  Cloud Logging and Sentry Logs would be duplicate instrumentation. Error lines still carry the
  method and the redacted URL. `apps/api/test/logging.test.ts` moves its redaction checks to the
  error line.
- **Database error messages are dropped.** Some Postgres messages repeat the input
  (`invalid input syntax for type …: "<value>"`), and Drizzle's `DrizzleQueryError` puts the
  query and its parameters, which can be a note's text, into its message and onto the error. For errors from the Postgres driver, the `err`
  serializer and Sentry's `scrub` keep the SQLSTATE `code` and the error's name, not its
  message. A test feeds one such error through both.
- `console.*` stays only in CLI scripts whose output is meant for a terminal.
- Tests: the severity mapping for every pino level; the trace field; the `err` serializer
  dropping extra fields and database messages; each changed call site logging at the level the
  rule gives; redaction on the error line.

**As built (2026-11-22), [ADR-0031](../adr/ADR-0031-structured-logs-and-the-logging-rule.md):**

- `apps/api/src/lib/logging/` exports `loggerOptions`, `requestLogSerializers`,
  `requestChildLogger`, `traceBindings`, `safeErrorFields` and `SEVERITY`. Only `app.ts` uses
  it today: the ops check arrives in workstream 5, and the CLI scripts keep `console.*` for
  the terminal.
- The `err` line keeps `type` (the constructor's name, since `DrizzleQueryError` sets no
  `name`), `message`, `stack` and a string `code`. A database error, or one with a database
  error as `cause`, keeps no message, and its stack keeps only the frames after the message:
  a parameter value can itself contain a line that looks like a frame. Sentry's `scrub` gets
  the same rule in workstream 2.
- The request serializer is the existing one (method and path, query dropped, share tokens
  redacted), moved into the module and bound to every line a request logs through Fastify's
  `childLoggerFactory`. The shared `redactUrl` arrives with workstream 2, which first needs it
  in the web app.
- `GOOGLE_CLOUD_PROJECT` is set by the release from `GCP_PROJECT_ID` (`apiConfig` in
  `scripts/resolve-release-image.mjs`); without it, lines carry no trace.
- `runMeteredCall` marks the ledger's errors with `own` from
  `apps/api/src/lib/assistant/ownErrors.ts`, moved out of `turn.ts`, which now imports it. A
  ledger failure in a capture or a tidy answers 500 and logs at `error`.
- An `AppError` 502, 503 or 504 logs `Request failed` at `warn` with its code and status, without
  a stack; any other 5xx at `error` with `err`.

### Workstream 2: Sentry errors, tracing and logs

The [Sentry design](../superpowers/specs/2026-11-07-sentry-design.md), with two changes: session
replay moves to workstream 7, and the logging parts it shares with workstream 1 are taken from
there. It covers both apps, releases and source maps, Web Vitals (collected by
`browserTracingIntegration` on page loads,
[automatic instrumentation](https://docs.sentry.io/platforms/javascript/guides/react/tracing/instrumentation/automatic-instrumentation/)),
Sentry Logs from the API, the projects in Terraform, the email alert on new issues, the DPA, the
privacy policy and `docs/GDPR.md`.

### Workstream 3: AI observability

- **Spans:** Sentry's Vercel AI integration, on by default in SDK v11, records "model, token
  usage, latency" per call ([Vercel AI](https://docs.sentry.io/platforms/javascript/guides/node/configuration/integrations/vercelai/)),
  inside the request's trace. Inputs and outputs are off (`dataCollection.genAI`), and a test
  proves no prompt or reply is attached.
- **Cost:** Sentry estimates cost from the model name and token counts, but "If… the model name
  doesn't match a known model, cost will be zero"
  ([costs](https://docs.sentry.io/product/agents/costs/)). The model boundary's per-attempt hook
  (ADR-0013) already prices each attempt for the ledger; it passes that cost to the span through
  the observability boundary, so Sentry and the ledger show the same number.
- **Failures, fallbacks and invalid output:** the existing log lines are the instrumentation.
  `assistant.provider_error` and `assistant.timeout` (`warn`), a `finishReason` other than a
  normal stop, `fields: null` from invalid output, and the rule-based tidy path are already
  logged; they become Sentry metric monitors (rates per hour), not new code.
- **Spend:** the ledger logs `assistant.spend_threshold` once per month when spend crosses 50 %
  and 90 % of the monthly cap; a Sentry monitor emails on it. At 100 % the cap already refuses
  calls.
- The price table (`budget/prices.ts`) charges 1.65 / 8.25 µUSD per input / output token, the
  `eu` (non-global) endpoint's price from 2027, as its comment records. Until 2026-12-31 the
  same endpoint is listed at half that, so cost estimates run about twice the real spend for
  the rest of 2026. That errs on the safe side and needs no change; the workstream's design
  re-checks the rows on the [pricing page](https://cloud.google.com/model-garden/pricing).

### Owner prerequisite before workstreams 4 and 5

`infra/terraform/bootstrap` (applied by the owner) gains: the `monitoring` and `cloudscheduler`
APIs; the Terraform service account's roles to manage uptime checks, alert policies,
notification channels, Cloud Scheduler jobs and Cloud Run Jobs; and the roles it may grant to
the ops-check service account. The owner applies it, as for every bootstrap change.

### Workstream 4: availability and alerts

- **Uptime checks** (Terraform, `google_monitoring_uptime_check_config`) on
  `https://wally.luminull.com/` and `https://api.wally.luminull.com/health`, from three regions
  every five minutes: about 52,000 executions a month against the free million. Each has an
  alert policy on the uptime metric (not charged) with an email notification channel.
  Whether email channels are free is **unverified**: no price is listed.
- `/health` already checks the database, so these checks also keep Supabase Free awake. The
  GitHub keepalive then duplicates them and is retired once the checks are proven. _My call._
- **Sentry metric monitors** (20 free) for: API error rate, p95 latency of the critical API
  routes, the AI monitors from workstream 3, the database size from workstream 5, and Web Vitals
  from workstream 7. Whether the Terraform provider manages metric monitors is **unverified**;
  if it doesn't, they are created in Sentry's UI and listed in DEPLOY.md.
- **Alert routing:** every alert goes by email to the owner. Each alert names the runbook
  section in DEPLOY.md that says what to check first.

### Workstream 5: ops check for scheduled work

§6, built: the job, its Terraform (`google_cloud_run_v2_job`, `google_cloud_scheduler_job`, a
service account allowed to run only that job; the `cloudscheduler` API enabled in
`bootstrap`), its release step (the job's image moves with the API's), and tests that each
failure condition fails the run.

### Workstream 6: cost and volume controls

- A table in DEPLOY.md of every quota this RFC relies on, its free limit, Wally's expected use and
  what happens at the limit (dropped, refused or billed). §8 is the first version.
- Billing stays alert-only (owner, 2026-11-08). Google's spend-cap budgets for Vertex and Cloud
  Run ([spend caps](https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps)) are
  recorded as an option, not used.
- Volume: Sentry sample rates (traces 0.2, replays only on error), log level `info`, and Cloud
  Logging's 30-day default retention.

### Workstream 7: UX performance and session replay (P1)

- Critical journeys: sign-in, open a board, add a note, ask the assistant. The router integration
  already names page loads and navigations by route, and the API spans by route, so the journeys
  need names in Sentry, not new instrumentation.
- Sentry metric monitors on p75 LCP and INP of those routes.
- Session replay as decided in the Sentry design: only on error, everything masked, no browser
  storage (owner decision 8 there); dropped if it cannot avoid storage.

### Workstream 8: product insights (P1)

Server-side only (owner, 2026-11-08): no browser tracking, no new processor, no change to the
privacy promise. The ops check also reports hourly **aggregate** counts as Sentry metrics, with
no user ids: notes created, suggestions shown, accepted and rejected, tidies proposed and
applied, assistant turns. AI effectiveness is the accept rate of suggestions and tidies. The
queries read tables the API already writes (`assistant_suggestions`, `assistant_tidies`, notes).

## 8. Free-tier budget

| Service                | Free limit                      | Wally's expected use            | At the limit          |
| ---------------------- | ------------------------------- | ------------------------------- | --------------------- |
| Sentry errors          | 5,000 a month                   | low                             | dropped, not billed   |
| Sentry spans           | 5M a month                      | traces at 0.2                   | dropped               |
| Sentry logs            | 5 GB a month                    | API `info` and above            | dropped               |
| Sentry replays         | 50 a month                      | only on error                   | dropped               |
| Sentry metric monitors | 20                              | about 10                        | cannot add more       |
| Sentry cron monitors   | 1                               | 1 (ops check)                   | needs a paid plan     |
| Cloud Logging          | 50 GiB a month, 30 days         | well below                      | $0.50/GiB             |
| Uptime checks          | 1M executions a month           | about 52,000                    | $0.30 per 1,000       |
| Uptime alert policies  | not charged (quoted 2026-11-08) | 2                               | not charged           |
| Cloud Scheduler        | 3 jobs per billing account      | 1                               | $0.10 per job a month |
| Cloud Run Jobs         | 240,000 vCPU-seconds a month    | about 720 runs of a few seconds | billed                |

Two limits can bill: Cloud Scheduler beyond three jobs per _billing account_ (other Luminull
projects count), and Cloud Logging beyond 50 GiB. The billing budget covers both.

## 9. Privacy

- Sentry is the only new processor. The DPA is signed before any event is sent (Sentry's Terms
  s.4.4). Event data stays in Frankfurt; account metadata is in the US.
- Cloud Monitoring and Cloud Scheduler are Google, already a processor.
- No new browser storage; no analytics in the browser; insights are aggregates.
- `privacy.html`, `legalPages.test.ts` and `docs/GDPR.md` change in workstream 2, the first one
  that sends anything to Sentry.

## 10. Testing and done

Each workstream's design lists its unit, integration and E2E tests; workstream 2's design sets
the pattern. The RFC is done when:

- a thrown error in the browser, an unexpected 5xx, a failed MCP tool and a failed ops check each
  reach Sentry once, with a readable stack, the release and a redacted URL, and email the owner;
- a request's browser span, API span, AI span and log lines share one trace;
- stopping the API or the web app emails within ten minutes;
- disabling the purge job emails within two hours;
- AI latency, failures, tokens and cost per call are visible in Sentry, with no content;
- searches in Sentry and Cloud Logging for a known share token, an email address and a prompt
  return nothing.

## 11. Open points for the workstream designs

- Whether the Terraform provider manages Sentry metric and cron monitors (else Sentry's UI).
- Whether Cloud Run honours an incoming W3C `traceparent`, which would let Cloud Logging and
  Sentry share one trace id instead of two linked ones.
- Whether email notification channels in Cloud Monitoring are free.
- Whether `gemini-3.8-flash` on Vertex matches a model in Sentry's cost table (the ledger's cost
  is passed in either way).
