# Platform migration: Supabase and Cloudflare

- **Status:** accepted by the owner on 2026-10-26; open decisions settled on 2026-10-27
  (section 8). Workstreams 1 and 2 are live since v0.12.0, and workstream 4 since v0.13.0
  (both 2026-11-01). Workstream 6 (Firebase retired) is live since v0.14.0
  (2026-11-01). See section 4.
- **Date:** 2026-10-26, updated 2026-10-27, 2026-10-31, 2026-11-01 and 2026-11-03
- **Source:** the owner's [tech stack and architecture brief](../researches/2026-10-26-tech-stack-and-architecture.md)
- **Decisions:** [ADR-0020](../adr/ADR-0020-supabase-postgres-through-the-api-with-drizzle.md) (data),
  [ADR-0022](../adr/ADR-0022-cloudflare-pages-and-api-proxy.md) (web hosting and API domain),
  [ADR-0023](../adr/ADR-0023-supabase-realtime-for-notification-events.md) (notification events),
  [ADR-0026](../adr/ADR-0026-new-google-cloud-project-created-with-terraform.md) (a new Google
  Cloud project, created with Terraform),
  [ADR-0027](../adr/ADR-0027-supabase-trusts-auth0-tokens-through-third-party-auth.md) (Supabase
  trusts Auth0 tokens). Identity stays with Auth0 ([ADR-0016](../adr/ADR-0016-auth0-for-web-and-mcp.md)).

This RFC replaces the [EU platform overview](RFC-0007-eu-platform-and-ai-workers.md) of 2026-10-19.

## 1. Outcome

Wally runs its data and Realtime on Supabase (Ireland, `eu-west-1`), with Auth0 as the identity
provider, Fastify kept on Cloud Run and the web app on Cloudflare. **Firebase (Firestore,
Authentication, Hosting) is decommissioned.** Every existing capability keeps working, in
particular:

- Boards, notes, sharing, invites, private notes, history, revisions and command receipts.
- The built-in assistant with its budgets, suggestions, tidies and audit.
- MCP for ChatGPT, including reads, writes, conflicts, replay safety, private-note
  isolation, Disconnect and Reconnect, and the request and write budgets
  ([connection model](../MCP_CONNECTION_MODEL.md)).
- **Nothing carries over from Firestore.** Production starts empty on PostgreSQL: no
  Firestore data is exported or imported (owner, 2026-10-27), so every user starts with a
  new, empty account there. Accounts are never merged by email alone.

The **Google Cloud project `luminull-wally` stays** for now. It also hosts Cloud Run, Artifact
Registry, Workload Identity Federation and Secret Manager. Decommissioning Firebase means
switching off Firebase products in that project, not deleting the project. Later, Wally moves
to a new project created with Terraform, which has never been linked to Firebase
([ADR-0026](../adr/ADR-0026-new-google-cloud-project-created-with-terraform.md)).

## 2. Target stack

The brief's table is authoritative for the choice of provider. In short:

- Supabase PostgreSQL with Drizzle, reached only by the API.
- Auth0 for web sign-in and as the MCP authorization server (ADR-0016). Where the browser
  talks to Supabase, Supabase trusts Auth0 tokens through Third-Party Auth (ADR-0027).
- Supabase Realtime for small notification events.
- Cloudflare Pages and DNS for the web app.
- A Cloudflare Worker as a pure reverse proxy for `api.wally.luminull.com`.
- Cloud Run `wally-api`, plus a private `wally-background` service fed by Cloud Tasks
  and Cloud Scheduler.
- Resend for notification email.
- Supabase Storage for uploads ([uploads RFC](RFC-0009-uploads-and-retrieval.md)).
- GitHub Actions to Artifact Registry to Cloud Run.
- Terraform for infrastructure, including a new Google Cloud project for Wally
  ([ADR-0026](../adr/ADR-0026-new-google-cloud-project-created-with-terraform.md)).

**Budget (replaces the €30/month ceiling of 2026-10-19):**

- Target $0/month during development.
- Under $50/month for the initial low-usage release, excluding tax and domains.
- AI spend at most $30/month, inside the $50 (owner, 2026-10-27).
- **Nothing is spent without the owner's manual approval:** no paid plan, add-on, or
  usage beyond a free allowance (owner, 2026-10-27).
- Supabase stays on Free. The owner decides when to move to Pro.
- Upgrade one component at a time, when a measured trigger in the brief's section 4 is met
  and the owner approves it.

## 3. Where Wally is today (checked 2026-10-26)

- **Data:** Firestore, named database `wally` (europe-west3), reached only through the
  API (ADR-0003). About 40 source files and 30 test files use the Admin SDK directly.
  There is no repository layer. Nothing in it is kept: the v0.11.0 release deleted all
  production data (ADR-0024), and the owner confirmed on 2026-10-27 that nothing is
  exported or carried over.
- **Identity:**
  - The production environment's release variables enable Auth0 login, open signup, and
    MCP with writes (`AUTH0_ENABLED`, `AUTH0_SIGNUP_ENABLED`, `MCP_ENABLED`,
    `MCP_WRITES_ENABLED`, `VITE_AUTH_PROVIDER=auth0`).
  - Auth0 and full MCP were first released in v0.8.3 (2026-10-25). Production runs
    v0.11.0 (deployed 2026-10-27), whose release deleted all production data (ADR-0024).
  - Firebase Authentication is the local and CI sign-in, not a production fallback: every
    production account is an Auth0 signup, so a switch back would give every user a new,
    empty account.
  - Identity mapping lives in `authIdentities`, keyed by `(issuer, subject)`.
  - Wally user IDs are random UUIDs created at Auth0 signup; none is a Firebase UID.
- **Web:** Firebase Hosting at `wally.luminull.com`. The API is at
  `api.wally.luminull.com` through a Cloud Run domain mapping, which is a Preview feature
  (ADR-0015).
- **Jobs:**
  - None for accounts. Self-service export and deletion and the `wally-account-cleanup`
    worker were removed in PR #76; the worker's cloud resources were deleted on 2026-10-27
    ([DEPLOY.md](../DEPLOY.md#account-cleanup-worker-retired)). Both are rebuilt
    on Supabase after the migration.
  - Board cleanup jobs drain inline after a command.
  - Firestore TTL policies expire receipts and assistant records.

## 4. Workstreams and order

Each workstream is one or more slices, each with its own plan, its own PR from `main`,
and its own E2E specs. Plans are not stacked.

| #   | Workstream                                                                | Depends on                    | Detail                                            |
| --- | ------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------- |
| 0   | **Proofs on a free project** (no production change), including backups    | none                          | Section 5                                         |
| 1   | **Postgres foundation:** schema, migrations, local database, test harness | none (built first)            | [Data RFC](RFC-0008-firestore-to-supabase.md)     |
| 2   | **Persistence switch** (no data to carry over)                            | 0, 1                          | [Data RFC](RFC-0008-firestore-to-supabase.md)     |
| 3   | **Third-Party Auth:** Supabase trusts Auth0 tokens                        | the proof in section 5        | ADR-0027                                          |
| 4   | **Cloudflare Pages and API Worker**, then retire Firebase Hosting         | none (smallest; can go first) | ADR-0022                                          |
| 5   | **Background service, Realtime notifications, Resend**                    | 2, 3                          | [Durable workers](RFC-0010-durable-ai-workers.md) |
| 6   | **Decommission** Firestore, Firebase Auth and Firebase Hosting            | all, plus rollback windows    | Section 6                                         |

**Status (2026-11-01):**

- Workstreams 1 and 2 are live: v0.12.0 (2026-11-01) runs the API on Supabase PostgreSQL
  ([plan](../superpowers/plans/2026-10-31-api-on-postgres.md)). Its first two release
  attempts stopped safely at the migrations step: the secret held the direct host, then a
  pooler string with a wrong password (section 8).
- Workstream 4 is live: v0.13.0 (2026-11-01) deploys two Cloudflare Workers, `wally-web`
  and `wally-api-proxy`, and no longer deploys to Firebase Hosting
  ([design](../superpowers/specs/2026-11-01-cloudflare-edge-design.md),
  [plan](../superpowers/plans/2026-11-01-cloudflare-edge.md)). The owner moved both
  hostnames to the Workers the same day, and every check passed, including an assistant
  question and a ChatGPT read. The Cloud Run domain mapping is deleted. Its Worker proof
  passed (section 5, item 5).
- Workstream 6 is live since v0.14.0 (2026-11-01): Firebase is retired, including
  Firebase Authentication (owner's decision of 2026-11-01). Auth0 is the only sign-in, locally and in CI as well
  ([design](../superpowers/specs/2026-11-01-retire-firebase-design.md),
  [plan](../superpowers/plans/2026-11-01-retire-firebase.md)). The owner deleted the
  Firebase resources the same day ([DEPLOY.md](../DEPLOY.md#firebase-retired)).
- No other workstream has started.

**The foundation goes first (owner, 2026-10-27).** Workstream 1 changes nothing in
production and needs no Supabase account, so it is built before the proofs. Each proof
still gates the slice that depends on it: database connectivity and the Data API switch
gate workstream 2 (backups were dropped as a gate by the owner on 2026-10-31); the Third-Party Auth proof gates workstream 3; the Worker proof gates
workstream 4. The foundation's design is in
[the slice 1 design](../superpowers/specs/2026-10-27-postgres-foundation-design.md).

## 5. Proofs before any production change (workstream 0)

Each item below is either documented but not yet exercised by Wally, or not documented.
Each has to be proven on a free project before the slice that depends on it.

1. **Database connectivity from Cloud Run (Belgium) to Supabase (Ireland):**
   - Use the transaction pooler on port 6543. It is IPv4 on the Free plan and does not
     support prepared statements.
   - The direct endpoint is IPv6 unless the IPv4 add-on is bought
     ([connecting](https://supabase.com/docs/guides/database/connecting-to-postgres)).
   - Measure latency for the heaviest board command transaction.
2. **Supabase trusts Wally's Auth0 tokens** (ADR-0027):
   - An Auth0 ID token issued by `https://login.luminull.com/` joins the user's own private
     Realtime channel and no other. Whether the Auth0 integration accepts the custom-domain
     issuer is _unverified_; the custom OIDC provider is the fallback
     ([Third-Party Auth](https://supabase.com/docs/guides/auth/third-party/overview)).
   - REST and MCP access tokens are refused.
3. **Data API switched off** while Realtime private channels still work. Switching
   off the Data API is documented
   ([securing your API](https://supabase.com/docs/guides/api/securing-your-api)). Running
   Realtime with it off is not.
4. **Backup and restore on Free.** Free has no managed backups, and Supabase recommends
   regular `supabase db dump` exports
   ([backups](https://supabase.com/docs/guides/platform/backups)). Prove an encrypted
   nightly dump stored outside Supabase, and a timed restore into a fresh project.
5. **The Worker proxy carries long requests:**
   - Assistant calls are not streamed today: they use `generateText`, and a single
     request waits up to about 55 s.
   - Prove that such requests, and the MCP endpoint, pass through the Worker within the
     Free plan's per-request CPU limit. That they do is _unverified_.
   - Prove that private responses are never cached.

   **Proven on 2026-11-01** with the real proxy and web Worker code under throwaway names,
   against a throwaway Cloud Run origin, on Workers Free
   ([design, proof results](../superpowers/specs/2026-11-01-cloudflare-edge-design.md#proof-results-2026-11-01)):
   - Held responses of 30, 60, 90 and 110 s passed; at about 125 s Cloudflare answers 524.
   - CPU time was 0–2 ms per request, including the 60 s hold.
   - Streaming passes chunk by chunk, so a streamed assistant would also work.
   - Nothing was cached, even a response marked `public, max-age=600`.
   - An MCP-shaped POST and non-browser clients passed the zone's bot settings, from a home
     IP; the cutover's real ChatGPT call is the last check. _Later:_ the first release
     through Cloudflare (v0.14.0) was challenged by Bot Fight Mode from its GitHub runner,
     so Bot Fight Mode is off ([DEPLOY.md](../DEPLOY.md#zone-security-for-luminullcom)).
   - An unreachable origin gets Cloudflare's own error page (530, 524), not the proxy's 502.

## 6. Decommissioning and rollback

- **Rollback windows:**
  - Each cutover defines its rollback window and how writes made after cutover are
    recovered before it starts.
  - Nothing is deleted at a provider until that window has closed and a restore drill on
    the new side has passed.
  - Permanent dual writes are not allowed.
- **Firebase (workstream 6):** done, live since v0.14.0; the owner ran the resource
  deletions on 2026-11-01, recorded in [DEPLOY.md](../DEPLOY.md#firebase-retired).
  - **Firestore:** no final export, since nothing is kept (owner, 2026-10-27). The `wally`
    database goes, and with it its indexes and TTL policies. The rules and indexes release
    steps were already gone (workstreams 2 and 4).
  - **Firebase Authentication** goes now (owner, 2026-11-01): it served only local
    development and CI, which move to Auth0.
    Its accounts, sign-in settings, web app registration and browser key were deleted on
    2026-11-01.
  - **Firebase Hosting:** its custom domain was removed in the console right after the
    Cloudflare cutover was verified, with no window (owner, 2026-11-01), but Hosting still
    listed it; it is deleted here. The default site cannot be deleted, so it is disabled.
    The Cloud Run domain mapping was deleted on 2026-11-01.
  - **Code and docs:** `firebase-admin`, `firebase` and every Firebase setting are removed;
    DEPLOY, SETUP, GDPR, AUTH0, the architecture overview and the indexes are updated in the
    same change.
  - **What stays:** the Google Cloud project, which Google does not let Firebase be removed
    from (DEPLOY, Firebase retired).

## 7. Review of the brief

The brief was checked against the repository and vendor documentation on 2026-10-26.
Points marked _unverified_ must be confirmed in the slice that relies on them.

1. **Browser access to Supabase is new:**
   - The browser will talk to Supabase Realtime directly, with its Auth0 token (ADR-0027).
     ADR-0003's "no database client in the web app" and ADR-0006's "no real-time channel"
     no longer hold as written, so ADR-0020 and ADR-0023 replace them.
   - Table data still goes only through the API.
   - Realtime private channels are authorized by RLS policies on `realtime.messages`
     ([Realtime authorization](https://supabase.com/docs/guides/realtime/authorization)).
     This is the first authorization logic that lives in the database, and it must stay
     limited to "a user receives only their own events".
2. **Cloudflare Pages:** Cloudflare's Pages documentation now says "Start new projects
   with Workers" ([Pages](https://developers.cloudflare.com/pages/)). Wally already
   needs a Worker for the API, so serving the SPA as Workers static assets is a
   free-plan alternative to confirm in workstream 4 (ADR-0022).
3. **Keyless releases:**
   - ADR-0008 holds no long-lived cloud credentials.
   - Deploying to Cloudflare, and running migrations against Supabase, both need tokens
     or passwords stored as GitHub or Secret Manager secrets.
   - They should be scoped as narrowly as each provider allows, and their rotation
     recorded.
4. **Region and processors:**
   - The brief does not name a Supabase region. Frankfurt was the requirement; the owner
     kept the project in Ireland (`eu-west-1`) on 2026-10-31 (section 8). Both are EU.
   - Cloudflare, Supabase and Resend become processors, and Google drops out for
     identity; Auth0 stays. GDPR.md changes in each cutover slice.
5. **Free plan risk:**
   - Production data is real from the first signup on Supabase.
   - The brief rightly states that Free has no managed backups and can pause.
   - The backup routine and restore drill (section 5, item 4) were planned as cutover
     gates; the owner deferred them on 2026-10-31 and accepts running without backups
     for now (section 8).
6. **Cloud Run free tier:** the brief says the free tier is applied using Tier 1
   pricing. Whether europe-west1 is a Tier 1 region is _unverified_: the pricing page
   could not be read on 2026-10-26.
7. **Wording:** the brief mentions "workspace permissions". Wally has boards and
   memberships, not workspaces, and nothing here introduces workspaces.
8. **AI:**
   - The brief's provider-independent AI SDK matches ADR-0013.
   - Production uses Vertex AI in the EU.
   - The Gemini free developer tier is only for synthetic data, as the brief says.
9. **No background service exists yet:**
   - The brief says to keep the existing Cloud Scheduler → private Cloud Run background
     service arrangement. It no longer exists: the only scheduled workload, the
     account-cleanup Cloud Run job, was removed in PR #76
     ([DEPLOY.md](../DEPLOY.md#account-cleanup-worker-retired)).
   - `wally-background` and its Scheduler job are therefore new in workstream 5.
   - Supabase Free can pause a project after about seven days of low database activity
     (owner brief). Until the background service queries PostgreSQL regularly, a
     keepalive needs a decision.

## 8. Owner decisions

Decided on 2026-10-27:

- **Email:** Resend sends all email.
- **Target stack:** the owner brief.
- **Data:** Firestore data is deleted. Nothing is exported or carried over.
- **Infrastructure tooling:** Terraform.
- **Storage:** Supabase Storage for uploads.
- **AI spend:** at most $30/month, inside the $50 ceiling.
- **Spending:** nothing is spent without the owner's manual approval.
- **Pro upgrade:** stay on Free; the owner decides when to move to Pro.

Decided on 2026-10-31:

- **Region:** the hosted project (`wally`, ref `jztzhyxshwgjrwscibly`, created 2026-10-26)
  stays in Ireland (`eu-west-1`), not Frankfurt. A Supabase region cannot be changed after
  creation; the project was empty, and the owner chose to keep it. The data stays in the EU.
- **Data API:** switched off by the owner. Checked from outside on 2026-10-31 with the
  publishable key: `/rest/v1/<table>` and `/graphql/v1` answer 503 (`PGRST002`) every time,
  so they serve nothing, while `/auth/v1/health` answers 200. Repeated after the schema was
  applied, against real tables and `rpc/purge_expired`: still 503. Realtime with the Data
  API off is still unproven (section 5, item 3).
- **Schema applied:** the owner ran `migrate-cli --require-purge-job` on 2026-10-31 from
  their machine. _Corrected 2026-11-01:_ that run used the direct host, which on the Free
  plan answers only over IPv6, as the owner's machine has; it did not go through the
  transaction pooler, as this entry first said. GitHub runners and Cloud Run have no IPv6
  by default, so v0.12.0's first two attempts failed safely at the migrations step until
  the `wally-database-url` secret held the transaction pooler URL (port 6543, user
  `postgres.<project-ref>`). That release then proved Drizzle's migrator and the pg_cron
  setup through the pooler. Checked afterwards: both migrations recorded, 19 tables with RLS
  and no policies, `wally-purge-expired` active hourly as `postgres`, and the Data API roles
  cannot execute `purge_expired`. The security advisor reports only the intended "RLS
  enabled, no policy" notice. A GitHub runner cannot run this before the release: the
  deploy identity is bound to the `production` environment and its `v*` tag policy, so the
  first release proves that part.
- **Expiry:** Supabase Cron (pg_cron) runs the purge. Checked on the hosted project on
  2026-10-31: pg_cron 1.6.4 is available on the Free plan and preloaded, and jobs run in the
  `postgres` database.

- **Backups: none for now.** Free has no managed backups (section 5, item 4), and the owner
  decided on 2026-10-31 to run without a backup routine for now; it no longer gates the
  switch. Accepted risk: data lost on Supabase (a bad migration, a mistaken delete, an
  incident) cannot be recovered. Revisit before real users depend on Wally, or with the
  move to Pro, whose daily backups the owner approves when the time comes.

Decided on 2026-11-01:

- **A new Google Cloud project, later:** Firebase cannot be removed from `luminull-wally`, and
  switching its Firebase plan to Spark unlinked billing and stopped Cloud Run on 2026-11-01.
  Wally moves to a new project created with Terraform, when Terraform is adopted; not now, by
  hand ([ADR-0026](../adr/ADR-0026-new-google-cloud-project-created-with-terraform.md)).

Still open:

- **Rollback windows** for the remaining cutovers.
- **Terraform scope:** which resources it manages first. The new Google Cloud project of
  ADR-0026 is part of it.

## 9. Operations the brief expects from day one

- **Before production switches to PostgreSQL:**
  - Billing alerts on Google Cloud, Supabase and Cloudflare. Alerts are not caps.
  - Supabase project-owner emails switched on, so pause warnings reach the owner.
- **Dashboards:**
  - API p95 latency and errors;
  - database size against the 500 MB quota;
  - queue age and notification delay;
  - Realtime connections and messages;
  - AI spend.
- **Email volume:** Resend's free allowance is 3,000 emails a month and 100 a day (owner
  brief). Notification email shares that limit.
