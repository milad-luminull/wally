# Wally provider research: EU platform, AI, storage and jobs

> **2026-10-26:** the owner's [tech stack brief](2026-10-26-tech-stack-and-architecture.md)
> reverses the identity choice below. Supabase Auth replaces Auth0, Cloudflare Pages
> replaces Firebase Hosting, and the budget becomes a target of $0 in development and
> under $50/month at release. See [Platform migration](../rfcs/0011-platform-migration.md).
> The comparison below is kept as dated research.

- **Research date:** 2026-10-19
- **Purpose:** support the [Firestore-to-Supabase migration](../rfcs/0008-firestore-to-supabase.md)
  and [EU platform and AI workers RFC](../rfcs/0007-eu-platform-and-ai-workers.md).
- **Original interactive analysis:** [offline HTML snapshot](2026-10-19-provider-strategy.html).
- **Status:** dated comparison and recommendation, not an accepted architecture decision,
  benchmark, live billing audit or implemented migration.

The snapshot preserves the analysis presented in the conversation, including its
calculators and official references. Its Supabase Auth recommendation predates the
repository's explicit Auth0 direction. The owner accepted **Supabase for data and files
and Auth0 for identity** on 2026-10-19. Supabase Auth will not be used; Neon remains a
historical competitor, not an open selection. The snapshot does not override
[ADR-0016](../adr/0016-auth0-for-web-and-mcp.md). Local source-file links inside the snapshot
are machine-specific; repository-relative links in this document and the RFC are canonical.

## Scope and recommendation

Wally has no customers yet. The owner wants text assistants, document search, live voice,
autonomous agents and integrations, with EU customer data preferred and up to €30/month
in infrastructure before customers, excluding AI. The owner's policy is to remain on
Free tiers as long as practical, including early live usage, with a modest budget
increase planned as more users arrive. Upgrade timing follows measured usage and
service needs; €30 is an initial ceiling, not a spending target. Multiple future apps
matter too.

The initial Neon preference weighted many idle databases heavily. After considering
feature breadth, uploads and community, the recommendation became **Supabase for a broad
Wally backend, with Cloud Run retained for the API and workers**. Neon remains attractive
for multiple intermittent apps. Neither database host determines which AI models can be
called, and neither choice makes migration trivial.

## Competitors and tradeoffs

- **Google Cloud / Firebase:** best continuity for the existing deployment. Keep Cloud Run
  and the container/release pipeline. Firestore remains viable, but PostgreSQL is the
  proposed direction for relational queries, retrieval and durable workflow state.
  Firebase Auth's documented US processing is an EU constraint. Switching databases
  requires re-proving transactions, revisions, receipts and permission filters.
- **Supabase + Cloud Run:** established integrated Postgres, Auth, files, Realtime,
  functions, Queues and Cron. Preferred for one feature-rich app when the bundle reduces
  integration work. Free supports two active projects with 500 MB DB and can pause after
  a week idle; automatic backups are absent. Pro starts at $25 for one Micro, additional
  Micro projects from $10/month. With Auth0 retained, part of the bundle goes unused.
- **Neon + independent identity + Cloud Run:** particularly compelling for branching,
  autoscaling and scale-to-zero databases across intermittent apps. Current Free terms
  list 100 projects, 100 CU-hours and 1 GB DB per project. Launch has no mandatory base:
  $0.106/CU-hour and $0.35/GB-month primary database storage. History, transfer and other
  services are additional. Cold starts, pooling and cross-cloud latency require measurement.
- **Cloudflare:** useful DNS and future static SPA hosting. Static assets are free;
  Worker code, AI and other products have separate meters. Workers are not a drop-in
  replacement for the existing container. Free global edge services do not establish
  EU-only processing; Regional Services is an Enterprise add-on.
- **Vercel:** useful when a Next.js workflow justifies it; Wally is already a Vite SPA
  with a separate API. Hobby is personal/non-commercial. A paid frontend platform adds
  cost without an identified requirement for this implementation.
- **AWS / Azure:** credible alternatives for specific customer requirements and AI
  endpoints. Moving the whole app has no demonstrated immediate benefit. Bedrock
  geographic profiles and Azure EU Data Zone deployments need feature-specific review.
- **Self-managed EU server:** control and portable software, but rental excludes the
  work of patching, monitoring, backups, restores and incident response. Not the preferred
  pre-customer operational commitment.

Sources: [Cloud Run](https://cloud.google.com/run/pricing),
[Firebase privacy](https://firebase.google.com/support/privacy),
[Supabase plans](https://supabase.com/pricing), [Neon plans](https://neon.com/pricing),
[Cloudflare static assets](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/),
[Workers billing](https://developers.cloudflare.com/workers/platform/pricing/),
[Regional Services](https://developers.cloudflare.com/data-localization/regional-services/),
[Vercel Hobby](https://vercel.com/docs/plans/hobby).

## Neon versus Supabase: features and community

Both are PostgreSQL platforms with vector capabilities. Neon now also offers Managed
Better Auth, object storage, functions and an AI gateway; the expanded backend suite's
GA announcement is dated September 2026. Realtime is Beta on the current pricing page.
Calling Neon only a database would be outdated. Its newer bundled services have less
accumulated community history than its database product.

Supabase has the larger publicly visible full-stack ecosystem. This is an assessment
from product scope and public repositories, not a measured response-time comparison.
Free community assistance is not a support SLA. Supabase Pro includes email support;
that does not imply Enterprise availability guarantees. Feature breadth alone does not
make Supabase the cheapest choice for many isolated apps.

Sources: [Neon backend announcement](https://neon.com/blog/neon-backend-is-ga),
[Supabase repository](https://github.com/supabase/supabase),
[Neon repository](https://github.com/neondatabase/neon).

## Files: capacity, limits and costs

Stored volume, maximum single-file size and monthly downloads are different limits.
Supabase Free includes 1 GB retained files, maximum 50 MB each. Pro includes 100 GB;
additional retained storage is $0.0213/GB-month and the maximum file limit can be
configured up to 500 GB. At 200 GB retained, its $25 base plus storage is about $27.13,
before other charges. At 5 MB/file, 100 GB is approximately 20,000 files, ignoring
versions and derived assets.

Neon Free includes 5 GB object storage/project. Paid object storage is $0.023/GB-month,
with no per-operation charge; 100 GB is $2.30 for files alone, plus database and other
services. Objects are limited to 5 GiB; Frankfurt storage is supported. Public transfer
uses the plan's separate allowance. Do not subtract Free allowances from paid examples
without checking the paid plan's rules.

Supabase Free includes 5 GB ordinary and 5 GB cached egress. Pro includes 250 GB of each,
then $0.09/GB ordinary and $0.03/GB cached. Cross-cloud worker reads can consume transfer.
OCR, transcription, embeddings, previews and model analysis are extra costs. Proposed
product limits can be lower than provider limits.

Sources: [Supabase file limits](https://supabase.com/docs/guides/storage/uploads/file-limits),
[Neon storage limits and regions](https://neon.com/docs/storage/overview), and the linked
provider pricing pages.

## AI deployment, queues and jobs

A dedicated agent service on Cloud Run is a proper deployment for existing TypeScript
code. Durable state, checkpoints, cancellation, permissions, approvals and budgets are
still required. A specialist managed agent runtime can reduce work around sessions,
memory and observability, but requires compatibility and EU checks. Hosting does not
include model inference. Keep live voice on its realtime path; queue post-call work.

The proposed dispatch pipeline is: authorized upload/request → durable run and outbox →
Cloud Tasks → authenticated Cloud Run worker → checkpoint/result. The queue stores a run
reference, not file contents. A scheduler creates work on a timetable; workers execute it.
Retries can repeat delivery, so stable IDs and command receipts prevent duplicate effects.
Long runs need resumable steps or separately tracked Cloud Run Job completion.

Cloud Tasks includes 1 million operations/month, then $0.40/million. Calls and delivery
attempts count in 32 KB chunks. At one creation and one delivery per small task, with
no retries or other calls, 100,000 tasks use about 200,000 operations and fit an unused
free allowance; 1 million tasks use about 2 million operations and cost about $0.40 for
the queue alone. Cloud Scheduler includes three schedules/account, then approximately
$0.10/schedule per 31 days, independent of execution frequency.

Execution is separate. At illustrative Cloud Run Jobs Tier-1 rates, 10,000 jobs each
running 60 seconds with 1 vCPU and 0.5 GiB RAM cost $11.40 before free credits:
`10,000 × 60 × (0.000018 + 0.5 × 0.000002)`. Jobs have a minimum billed minute per started
instance; startup, retries and network are excluded. HTTP workers use different billing.
Cloud Tasks HTTP delivery attempts allow at most 30 minutes. Supabase Queues and Cron
are alternatives consuming database resources and invoked worker capacity, rather than
a separate per-message queue subscription. Neither option makes execution or AI free.

Sources: [Agent Runtime](https://docs.cloud.google.com/gemini-enterprise-agent-platform/build/runtime),
[Cloud Tasks prices](https://cloud.google.com/tasks/pricing),
[HTTP task deadlines](https://docs.cloud.google.com/tasks/docs/dual-overview),
[Scheduler prices](https://cloud.google.com/scheduler/pricing),
[Cloud Run prices](https://cloud.google.com/run/pricing),
[Supabase Queues](https://supabase.com/docs/guides/queues),
[Supabase Cron](https://supabase.com/docs/guides/cron).

## Budget examples and limits of the recommendation

For a paid Neon database, approximate primary compute/storage as
`active hours × average CU × $0.106 + stored GB × $0.35` per project. At 0.25 CU and 1 GB,
100 active hours is $3.00 and 730 hours is about $19.70. Polling can keep it awake.
Three such intermittent databases total $9.00 versus a $45 Supabase Pro/Micro baseline
for three projects; at continuous usage the Neon example becomes about $59.09. These
are different service bundles, not equivalent total-stack quotes.

The interactive snapshot also models illustrative text inference: 3,000 input and
500 output tokens/call, at editable rates of $1 and $5 per million respectively.
100 interactions/day, six model calls each, for 30 days is $99. This is not a current
quote for a named model and excludes voice, reasoning overhead, embeddings and retries.

Prices are USD list rates researched on the stated date, excluding VAT and currency
conversion. Free allowances can already be consumed by other apps. Database history,
email, logging, builds, images, production ingress, support and recovery can add costs.
The €30 target may accommodate prototypes; it is not evidence that a paid, recoverable
production service with required availability fits that amount.

EU residency must be checked for content, auth, backups, logs, subprocessors and every
AI feature. OpenAI EU processing has eligibility/retention requirements; Google routes
must use a supported endpoint/model with an explicit location commitment. No automatic
global fallback is assumed. Neither provider survival nor future pricing is guaranteed.

Sources: [Google AI residency](https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/data-residency),
[OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data),
[Bedrock geography](https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html),
[Azure deployment geography](https://learn.microsoft.com/en-ie/azure/foundry/foundry-models/concepts/deployment-types?view=foundry).

Unverified: live bills, measured latency and throughput, restore time, complete account
migration, account-specific AI residency eligibility and selected voice-model regional
availability. Recheck current vendor terms before any purchase or implementation.
