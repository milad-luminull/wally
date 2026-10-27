<!--
Owner's decision brief, received 2026-10-26 and stored unchanged below this note.
It is the source for the platform decisions in ADR-0020 to ADR-0023 and for
../rfcs/RFC-0011-platform-migration.md, which also records the review of this brief against
Wally's current state. Where the RFC or an ADR is more specific, they win.
-->

# Wally — Tech Stack & Architecture

**Decision date:** 26 October 2026  
**Operating principle:** **Free-tier first, for as long as it remains sufficient.** Upgrade only when usage, reliability, or a specific product requirement justifies the expense.  
**Budget:** target **$0/month during development**, then **under $50/month** for the initial low-usage release. Figures are USD, excluding tax and domain registration; $0 is a target, not a guaranteed cloud bill.

## 1. Final technology decisions

| Category                               | Provider / technology                                                 | Starting plan                                                                |
| -------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Frontend                               | React, TypeScript, Vite                                               | Existing app; no rewrite                                                     |
| Frontend hosting, DNS                  | **Cloudflare Pages + DNS**                                            | Free                                                                         |
| Custom API domain (`api.mydomain.com`) | **Cloudflare Worker reverse proxy**                                   | Workers Free                                                                 |
| API and business logic                 | **Fastify + Node.js + Docker on Google Cloud Run**                    | Scale to zero; free execution allowance                                      |
| Background jobs                        | **Cloud Run + Cloud Tasks + Cloud Scheduler**                         | Free allowances; no always-on worker                                         |
| Database                               | **Supabase PostgreSQL + Drizzle**                                     | **Supabase Free**                                                            |
| Authentication                         | **Supabase Auth**                                                     | Free                                                                         |
| In-app notifications                   | **PostgreSQL + Supabase Realtime**                                    | Free; browser WebSocket to Supabase                                          |
| File storage                           | **Supabase Storage or Google Cloud Storage**                          | **Decision open**; prefer Supabase's included free storage for the prototype |
| AI integration                         | **AI SDK + interchangeable model adapters**                           | Free/synthetic-data development; paid models only when justified             |
| Transactional email                    | **Resend** configured as Supabase custom SMTP                         | Free allowance                                                               |
| Repository and CI/CD                   | **GitHub + Actions + Google Artifact Registry**                       | Included/free allowances                                                     |
| Secrets, logs, monitoring              | **Google IAM / Secret Manager / Cloud Logging + provider dashboards** | Free allowances where available                                              |
| Infrastructure configuration           | **OpenTofu or Terraform**                                             | No paid infrastructure platform                                              |

**Not included:** Kubernetes at launch, dedicated Redis/vector database, microservices, an AI gateway, paid monitoring, paid staging, or paid database recovery features.

## 2. Architecture

```text
Users / Browser
  |
  +-- app.mydomain.com --> Cloudflare Pages (React)
  |
  +-- api.mydomain.com --> Cloudflare Worker (free proxy)
  |                                |
  |                                v
  |                       Cloud Run: wally-api
  |                       Fastify / TypeScript / Docker
  |                                |
  |                    +-----------+-----------+
  |                    |                       |
  |                    v                       v
  |              Supabase Postgres         Cloud Tasks
  |                                            |
  |                                            v
  |                                  Cloud Run: wally-background
  |                                            ^
  |                                            |
  |                                      Cloud Scheduler
  |
  +-- Sign-in ----------------> Supabase Auth
  +-- Notification WebSocket -> Supabase Realtime
  +-- Signed file transfers --> Supabase Storage OR Google Cloud Storage

Background service --> PostgreSQL / selected AI provider / Resend
GitHub Actions ----> Artifact Registry ----> Cloud Run
```

Keep **one repository and a modular monolith**. The API and background service share domain code and can use the same Docker image with different entry points. Internal modules: access control, boards/notes/tasks, reminders, intelligence, notifications, attachments, integrations, and usage limits.

**API proxy:** Cloudflare forwards HTTPS requests and streaming responses to Cloud Run; it does not contain business logic. Use a Worker Custom Domain, not a Google load balancer. Keep private responses uncached. An origin-secret check can reject unauthorized direct application requests, but it does **not** prevent traffic from reaching the public Cloud Run origin or guarantee protection against origin-related charges. Give the background service private IAM-authenticated invocation.

**Notifications:** persist notifications in PostgreSQL, broadcast small recipient-authorized events through Supabase Realtime, and re-fetch unread notifications after reconnecting. Use SSE/HTTP streaming from Fastify only for interactive AI responses. No separate WebSocket server is needed.

## 3. Make the most of Supabase Free

| Supabase Free resource |                                 Included allowance |
| ---------------------- | -------------------------------------------------: |
| PostgreSQL database    |                             **500 MB per project** |
| Authentication         |                    **50,000 monthly active users** |
| File storage           |                                           **1 GB** |
| Outbound transfer      |                    **5 GB uncached + 5 GB cached** |
| Realtime               | **200 peak connections; 2 million messages/month** |
| Active projects        |                                        **Up to 2** |
| Subscription cost      |                                       **$0/month** |

Use one hosted Free project for testing/private beta and local Supabase tooling when possible. A second free hosted project is optional, **not required**. Be mindful of the small database and file quotas. The Free tier is suitable only while the availability, recovery, and capacity limitations are acceptable.

### Avoiding Supabase inactivity pauses

Supabase can pause Free projects after **approximately seven days of insufficient database activity**. Its documentation says **a few user database requests per day are typically enough** to avoid pausing, but this is **not guaranteed**.

**Recommended low-cost approach:**

1. Keep the existing **Cloud Scheduler → private Cloud Run background service** arrangement. If it is already querying PostgreSQL regularly to dispatch real reminders, no additional keepalive is necessary.
2. For a development project that would otherwise be idle, optionally schedule **one job every eight hours** that performs a small, authenticated, read-only database check through the background service (for example, checking for due reminders). It should **actually query PostgreSQL**; pinging a static URL is not equivalent to database activity.
3. Enable Supabase project-owner emails and watch for pause warnings. A warning can be addressed by visiting the project dashboard or generating real application/database activity.
4. If paused, open **Supabase Dashboard → project → Resume project**. Supabase currently documents a **one-year** in-dashboard restore window; do not treat this as a backup policy.

One recurring Scheduler configuration counts as **one job** regardless of how often it runs, and Google includes **three jobs per billing account**. Keepalive activity uses small amounts of Cloud Run and database resources, so monitor for charges.

**Important:** No heartbeat guarantees exemption from pausing. **Supabase Pro is the only documented way to guarantee that a Free project will not be automatically paused for inactivity.** Remain on Free as long as the risk is acceptable; upgrade when predictable uptime becomes necessary, not on an arbitrary date. See [Supabase project pausing](https://supabase.com/docs/guides/platform/free-project-pausing).

### Backups on Free

**Do not assume Supabase Free includes user-accessible managed backups.** Export PostgreSQL regularly with the Supabase CLI (`supabase db dump`) or `pg_dump`; store encrypted backups somewhere independent and test restoring them. Back up attachment **bytes** separately—database exports contain attachment metadata, not the files. Establish a real backup routine before inviting users to trust Wally with important data.

## 4. Free-first budget and upgrade triggers

| Service             | Free-first configuration                                                          | When to consider paying                                                         |
| ------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Supabase**        | Free: PostgreSQL, Auth, Realtime, optional Storage                                | Capacity limits, sustained reliability/backup needs, or unacceptable pause risk |
| **Cloudflare**      | Pages Free + Worker Free (**100,000 proxy requests/day**, **10 ms CPU/request**)  | Reaching limits or needing more processing/controls                             |
| **Cloud Run**       | Request-based billing, **minimum 0 instances**, small CPU/RAM and instance caps   | Measured traffic, latency, or execution usage exceeds free allowances           |
| **Cloud Tasks**     | First **1 million billable operations/month** free                                | Actual dispatch/retry volume                                                    |
| **Cloud Scheduler** | First **3 configured jobs/account** free                                          | More schedules than needed initially                                            |
| **Resend**          | **3,000 emails/month**, up to **100/day**, free                                   | Larger sign-in/notification mail volume                                         |
| **GitHub Actions**  | Use included minutes/storage; avoid excessive builds                              | CI demand exceeds plan allowances                                               |
| **AI**              | AI SDK; optional **Gemini free API only for synthetic/approved development data** | Real private-user data or API quotas require a suitable paid model              |
| **Storage**         | Supabase Free includes 1 GB; GCS remains an alternative                           | Real file volume, bandwidth, IAM, or region requirements                        |

**Expected monthly cost:**

- **Development:** **target $0**, with light use within free quotas.
- **Private beta:** **target $0–10**, depending on Google Cloud networking/registry/logging and any paid AI calls.
- **First paid upgrade:** Supabase Pro starts at **$25/month** when its benefits are actually required; keep the rest on free/usage-based plans.
- **Initial production cost ceiling:** **under $50/month is the target**, not a guarantee at arbitrary traffic or AI usage.

**Costs that can exist even at low traffic:** Google Cloud outbound network transfer, Artifact Registry storage, retained logs, object backups, external AI calls, domain fees, and Cloud Run usage outside its regional/aggregated allowances. Cloud Run's free tier is applied using **Tier 1 pricing**, so region matters. Review billing dashboards and enable alerts immediately; alerts are not hard caps.

**AI policy:** keep a **provider-independent AI SDK interface** rather than assuming OpenAI is mandatory. Test free Gemini models with synthetic/non-sensitive data only—its developer free tier permits content to be used to improve Google's products. For genuine private notes, choose a provider/plan with acceptable data-use terms and enforce feature-level token budgets, rate limits, and an off switch. No AI subscription is required to build the non-AI product.

## 5. Build and operate without unnecessary services

- **Data security:** verify every user token; enforce ownership and workspace permissions in Fastify and appropriate database policies. Keep server credentials out of the browser.
- **Jobs:** separate notification and AI queues; record durable job state and idempotency keys; retry safely. Keep reminder schedules in PostgreSQL, not one Scheduler job per user.
- **Uploads:** use private objects and short-lived signed upload/download URLs, with file quotas and type/size checks. Keep the final primary storage choice open.
- **Deployment:** GitHub Actions → test → build Docker image → Artifact Registry → run migrations once → deploy → smoke-test. Use Workload Identity Federation instead of long-lived Google service-account keys.
- **Observability:** begin with native dashboards. Watch API p95 latency, errors, DB capacity, queue age, notification delays, Realtime usage, and AI costs.
- **Scale:** tune containers and SQL first; upgrade only the constrained component. Adopt GKE/Kubernetes if a measured operational need justifies it. Reuse the Docker images and application code, but expect deployment/networking/IAM changes.

### Specific reasons to upgrade, not arbitrary deadlines

1. **Supabase Free → Pro:** users need dependable availability, accessible managed backups, or the Free quotas are exhausted. No point-in-time recovery initially.
2. **Cloudflare Workers Free → Paid:** proxy traffic or CPU exceeds Free limits.
3. **Cloud Run resources:** load tests or production metrics show insufficient response time or capacity.
4. **AI → paid:** private-user data processing or capability/volume cannot be responsibly supported by the free development model.
5. **Storage:** choose GCS over Supabase Storage only if integration, operational, regional, or cost measurements justify it.

**Decision:** Keep the agreed Docker-first architecture. **Start with Free plans and remain there for as long as they meet Wally's real needs.** Do not buy reliability guarantees, compute, recovery, or new services before those capabilities are necessary.

---

## Official references (checked 26 October 2026)

- [Supabase Free vs Pro pricing](https://supabase.com/pricing)
- [Supabase Free project pausing and resumption](https://supabase.com/docs/guides/platform/free-project-pausing)
- [Supabase backups and Free-tier exports](https://supabase.com/docs/guides/platform/backups)
- [Supabase Realtime limits](https://supabase.com/docs/guides/realtime/limits)
- [Cloudflare Workers pricing and Free limits](https://developers.cloudflare.com/workers/platform/pricing/)
- [Cloudflare Worker custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Google Cloud Run pricing](https://cloud.google.com/run/pricing)
- [Google Cloud Tasks pricing](https://cloud.google.com/tasks/pricing)
- [Google Cloud Scheduler pricing](https://cloud.google.com/scheduler/pricing)
- [Resend pricing](https://resend.com/pricing)
- [Gemini Developer API terms and free-tier pricing](https://ai.google.dev/gemini-api/docs/pricing)
