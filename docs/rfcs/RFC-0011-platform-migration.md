# Platform migration: Supabase, Supabase Auth and Cloudflare

- **Status:** accepted by the owner on 2026-10-26; planning, nothing migrated yet.
- **Date:** 2026-10-26
- **Source:** the owner's [tech stack and architecture brief](../researches/2026-10-26-tech-stack-and-architecture.md)
- **Decisions:** [ADR-0020](../adr/ADR-0020-supabase-postgres-through-the-api-with-drizzle.md) (data),
  [ADR-0021](../adr/ADR-0021-supabase-auth-for-web-and-mcp.md) (identity and MCP),
  [ADR-0022](../adr/ADR-0022-cloudflare-pages-and-api-proxy.md) (web hosting and API domain),
  [ADR-0023](../adr/ADR-0023-supabase-realtime-for-notification-events.md) (notification events)

This RFC replaces the [EU platform overview](RFC-0007-eu-platform-and-ai-workers.md) of 2026-10-19.

## 1. Outcome

Wally runs on one data and identity provider, Supabase (Frankfurt), with Fastify kept on
Cloud Run and the web app on Cloudflare. **Firebase (Firestore, Authentication, Hosting)
and Auth0 are decommissioned.** Every existing capability keeps working, in particular:

- Boards, notes, sharing, invites, private notes, history, revisions and command receipts.
- The built-in assistant with its budgets, suggestions, tidies and audit.
- MCP for ChatGPT, including reads, writes, conflicts, replay safety, private-note
  isolation, Disconnect and Reconnect, and the request and write budgets
  ([connection model](../MCP_CONNECTION_MODEL.md)).
- Existing accounts keep their Wally user ID and data. Accounts are never merged by
  email alone.

The **Google Cloud project `luminull-wally` stays**. It also hosts Cloud Run, Artifact
Registry, Workload Identity Federation and Secret Manager. Decommissioning Firebase means
switching off Firebase products in that project, not deleting the project.

## 2. Target stack

The brief's table is authoritative for the choice of provider. In short:

- Supabase PostgreSQL with Drizzle, reached only by the API.
- Supabase Auth for web sign-in and as the MCP authorization server.
- Supabase Realtime for small notification events.
- Cloudflare Pages and DNS for the web app.
- A Cloudflare Worker as a pure reverse proxy for `api.wally.luminull.com`.
- Cloud Run `wally-api`, plus a private `wally-background` service fed by Cloud Tasks
  and Cloud Scheduler.
- Resend for all email: Supabase Auth's custom SMTP and notification email.
- GitHub Actions to Artifact Registry to Cloud Run.
- OpenTofu or Terraform for infrastructure. Which one is open.

**Budget (replaces the €30/month ceiling of 2026-10-19):**

- Target $0/month during development.
- Under $50/month for the initial low-usage release, excluding tax and domains.
- Upgrade one component at a time when a measured trigger in the brief's section 4 is met.

## 3. Where Wally is today (checked 2026-10-26)

- **Data:** Firestore, named database `wally` (europe-west3), reached only through the
  API (ADR-0003). About 40 source files and 30 test files use the Admin SDK directly.
  There is no repository layer.
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

| #   | Workstream                                                                      | Depends on                    | Detail                                            |
| --- | ------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------- |
| 0   | **Proofs on a free project** (no production change)                             | none                          | Section 5                                         |
| 1   | **Postgres foundation:** schema, migrations, local stack, test harness, backups | 0                             | [Data RFC](RFC-0008-firestore-to-supabase.md)     |
| 2   | **Persistence switch and data cutover**                                         | 1                             | [Data RFC](RFC-0008-firestore-to-supabase.md)     |
| 3   | **Identity and MCP on Supabase Auth**, then retire Auth0                        | 2                             | [Identity RFC](RFC-0012-supabase-auth-and-mcp.md) |
| 4   | **Cloudflare Pages and API Worker**, then retire Firebase Hosting               | none (smallest; can go first) | ADR-0022                                          |
| 5   | **Background service, Realtime notifications, Resend**                          | 2, 3                          | [Durable workers](RFC-0010-durable-ai-workers.md) |
| 6   | **Decommission** Firestore, Firebase Auth, Firebase Hosting and Auth0           | all, plus rollback windows    | Section 6                                         |

**Data goes before identity.** Supabase Auth's users then sit in the same database as
Wally's tables, the identity mapping moves once, and the auth cutover does not also have
to carry a data cutover. Running both cutovers in one window is ruled out: if something
fails, nobody can tell which change caused it.

## 5. Proofs before any production change (workstream 0)

Each item below is either documented but not yet exercised by Wally, or not documented.
Each has to be proven on a free project before the slice that depends on it.

1. **Database connectivity from Cloud Run (Belgium) to Supabase (Frankfurt):**
   - Use the transaction pooler on port 6543. It is IPv4 on the Free plan and does not
     support prepared statements.
   - The direct endpoint is IPv6 unless the IPv4 add-on is bought
     ([connecting](https://supabase.com/docs/guides/database/connecting-to-postgres)).
   - Measure latency for the heaviest board command transaction.
2. **MCP on the Supabase OAuth 2.1 server** with ChatGPT as the client:
   - The server is in beta on all plans
     ([getting started](https://supabase.com/docs/guides/auth/oauth-server/getting-started)).
   - Its documented scopes are the OIDC scopes only, and resource indicators and token
     revocation are not documented
     ([token security](https://supabase.com/docs/guides/auth/oauth-server/token-security)).
   - Prove that the requirements in the identity RFC section 4 can be met. If they
     cannot, stop and bring a new decision; do not quietly keep Auth0.
3. **Data API switched off** while Auth and Realtime private channels still work. Switching
   off the Data API is documented
   ([securing your API](https://supabase.com/docs/guides/api/securing-your-api)). Running
   Auth and Realtime with it off is not.
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

## 6. Decommissioning and rollback

- **Rollback windows:**
  - Each cutover defines its rollback window and how writes made after cutover are
    recovered before it starts.
  - Nothing is deleted at a provider until that window has closed and a restore drill on
    the new side has passed.
  - Permanent dual writes are not allowed.
- **Firestore:** export a final snapshot, keep it encrypted for the agreed retention, then
  delete the `wally` database, the rules and indexes deploy, and the TTL policies.
- **Firebase Authentication and Auth0:**
  - Retire Firebase Authentication and Auth0 only after every active account has been
    shown to sign in through Supabase Auth.
  - Retire Auth0's custom domain `login.luminull.com` and its tenant.
  - Disconnect the ChatGPT client registered in Auth0.
- **Firebase Hosting:** retire it after the Cloudflare release has served for its window.
- **Code and docs:**
  - Remove `firebase-admin`, `firebase`, `@auth0/*` and the emulator image.
  - Remove `firebase.json`, the rules, the indexes and the matching release steps.
  - Update DEPLOY, SETUP, GDPR and the architecture overview in the slice that changes
    them.

## 7. Review of the brief

The brief was checked against the repository and vendor documentation on 2026-10-26.
Points marked _unverified_ must be confirmed in the slice that relies on them.

1. **Two identity migrations in a few weeks.**
   - Auth0 has only just gone live, so every Auth0 login moves again.
   - Every MCP connection has to be re-authorized, because tokens issued by Auth0 cannot
     be verified once Auth0 is gone.
   - Wally's own `(issuer, subject)` mapping makes the moves safe, but users will notice
     them.
2. **The MCP authorization server is in beta**, and its documented gaps are exactly what
   Wally's MCP relies on today:
   - separate REST and MCP audiences;
   - read and write scopes;
   - next-call revocation.

   Supabase documents a `client_id` claim in OAuth access tokens, and a Custom Access
   Token hook (Free plan) that can set claims such as `aud`
   ([auth hooks](https://supabase.com/docs/guides/auth/auth-hooks)). Wally must also
   build its own consent page. See the identity RFC.

3. **Automatic identity linking:**
   - Supabase Auth automatically links identities that share a verified email address
     ([identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking)).
   - The page does not say this can be turned off.
   - Wally's mapping therefore has to treat the Supabase user, not the email, as the
     identity, and the import must create that user explicitly for each existing account.
4. **Email must be set up before auth cutover:**
   - Without custom SMTP, Supabase Auth sends 2 emails per hour, and only to the
     project's team ([custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)).
   - So Resend must be configured before any real sign-up or password reset.
5. **Password accounts:**
   - Moving password hashes out of Auth0 is _unverified_ on the Free plan.
   - Plan for a password reset for the few password accounts, as the Auth0 move already
     did.
6. **Browser access to Supabase is new:**
   - The browser will talk to Supabase Auth and Realtime directly. ADR-0003's "no
     database client in the web app" and ADR-0006's "no real-time channel" no longer hold
     as written, so ADR-0020 and ADR-0023 replace them.
   - Table data still goes only through the API.
   - Realtime private channels are authorized by RLS policies on `realtime.messages`
     ([Realtime authorization](https://supabase.com/docs/guides/realtime/authorization)).
     This is the first authorization logic that lives in the database, and it must stay
     limited to "a user receives only their own events".
7. **Cloudflare Pages:** Cloudflare's Pages documentation now says "Start new projects
   with Workers" ([Pages](https://developers.cloudflare.com/pages/)). Wally already
   needs a Worker for the API, so serving the SPA as Workers static assets is a
   free-plan alternative to confirm in workstream 4 (ADR-0022).
8. **Keyless releases:**
   - ADR-0008 holds no long-lived cloud credentials.
   - Deploying to Cloudflare, and running migrations against Supabase, both need tokens
     or passwords stored as GitHub or Secret Manager secrets.
   - They should be scoped as narrowly as each provider allows, and their rotation
     recorded.
9. **Region and processors:**
   - The brief does not name a Supabase region. Frankfurt stays the requirement for data,
     auth and Realtime.
   - Cloudflare, Supabase and Resend become processors, and Google and Auth0 drop out
     for identity. GDPR.md changes in each cutover slice.
10. **Free plan risk:**
    - Production data is real today.
    - The brief rightly states that Free has no managed backups and can pause.
    - The backup routine and restore drill (section 5, item 4) are therefore cutover gates,
      not follow-ups.
11. **Cloud Run free tier:** the brief says the free tier is applied using Tier 1
    pricing. Whether europe-west1 is a Tier 1 region is _unverified_: the pricing page
    could not be read on 2026-10-26.
12. **Wording:** the brief mentions "workspace permissions". Wally has boards and
    memberships, not workspaces, and nothing here introduces workspaces.
13. **AI:**
    - The brief's provider-independent AI SDK matches ADR-0013.
    - Production uses Vertex AI in the EU.
    - The Gemini free developer tier is only for synthetic data, as the brief says.
14. **No background service exists yet:**
    - The brief says to keep the existing Cloud Scheduler → private Cloud Run background
      service arrangement. It no longer exists: the only scheduled workload, the
      account-cleanup Cloud Run job, was removed in PR #76
      ([DEPLOY.md](../DEPLOY.md#account-cleanup-worker-retired)).
    - `wally-background` and its Scheduler job are therefore new in workstream 5.
    - Supabase Free can pause a project after about seven days of low database activity
      (owner brief). Until the background service queries PostgreSQL regularly, a
      keepalive needs a decision.

## 8. Open owner decisions

Decided on 2026-10-27: Resend sends all email, and the owner brief is the target stack.
Still open:

- **Rollback windows** for the data and identity cutovers, and the retention of the final
  Firestore export.
- **Infrastructure tooling:** OpenTofu or Terraform, and which resources it manages first.
- **Storage:** Supabase Storage or Google Cloud Storage for uploads (open in the brief;
  [uploads RFC](RFC-0009-uploads-and-retrieval.md)).
- **AI spend:** does the assistant's monthly spend cap count inside the $50 ceiling? The
  brief lists AI calls as a separate, usage-dependent cost.
- **Pro upgrade:** when production data moves, stay on Free with our own backups, or
  move to Pro. The brief says stay on Free until a trigger is met. The restore drill
  decides whether our own backups are enough.

## 9. Operations the brief expects from day one

- **Before production data moves:**
  - Billing alerts on Google Cloud, Supabase and Cloudflare. Alerts are not caps.
  - Supabase project-owner emails switched on, so pause warnings reach the owner.
- **Dashboards:**
  - API p95 latency and errors;
  - database size against the 500 MB quota;
  - queue age and notification delay;
  - Realtime connections and messages;
  - AI spend.
- **Email volume:** Resend's free allowance is 3,000 emails a month and 100 a day (owner
  brief). Resend sends every email, so notifications share the daily limit with sign-in
  and recovery mail.
