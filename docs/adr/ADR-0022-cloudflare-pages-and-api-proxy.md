# ADR-0022: Cloudflare Pages for the web app and a Worker proxy for the API domain

- **Status:** accepted; amended 2026-11-01 (Workers static assets, no rollback window, Confirmation)
- **Date:** 2026-10-26
- **Deciders:** Milad Rezazadeh
- **Supersedes:**
  - [ADR-0015](ADR-0015-cloudflare-dns-and-wally-custom-domains.md).
  - The Firebase Hosting target in
    [ADR-0008](ADR-0008-tag-triggered-release-to-hosting-and-cloud-run.md). Its approved,
    smoke-tested Cloud Run release stays in force.

## Context and problem statement

Firebase Hosting serves the SPA at `wally.luminull.com`. `api.wally.luminull.com`
reaches Cloud Run through a Cloud Run domain mapping, which is a Preview feature
(ADR-0015). Cloudflare already holds DNS.

The owner is decommissioning Firebase and chose Cloudflare Pages, plus a Worker reverse
proxy for the API domain
([tech stack brief](../researches/2026-10-26-tech-stack-and-architecture.md)).

The question: where does the web app live, and how does the API domain reach Cloud Run?

## Considered options

1. **Pages for the SPA, and a Worker on a custom domain proxying to Cloud Run:**
   - Good: Free, with no Google load balancer.
   - Bad: a second release target.
2. **Workers static assets for the SPA, in the same Worker as the proxy:**
   - Good: Cloudflare's Pages documentation says "Start new projects with Workers"
     ([Pages](https://developers.cloudflare.com/pages/)).
   - Bad: SPA and API routing are coupled in one deployable.
3. **Keep Firebase Hosting and the domain mapping:**
   - Good: no work.
   - Bad: keeps Firebase and the Preview mapping.
4. **A Google external load balancer:**
   - Good: managed ingress.
   - Bad: it bills while idle.

## Decision outcome

Chosen option: **option 1**, as decided by the owner. The hosting slice confirms Pages
against option 2. Both are Free and follow the rules below, so moving from one to the
other needs no new ADR.

**Built (2026-11-01):** the owner chose Workers static assets over Pages, in a Worker of its
own (`wally-web`), separate from the proxy (`wally-api-proxy`). That keeps option 2's
mechanism without its coupling: both deployables then share one release path (versions,
preview URLs, `wrangler rollback`), and an assets-only Worker's requests are free and
unlimited. The [workstream 4 design](../superpowers/specs/2026-11-01-cloudflare-edge-design.md)
records the details and the Worker proof.

- **The Worker only forwards.**
  - No business logic, and no buffering of long requests.
  - It never caches private responses.
  - It keeps the `Authorization` header and passes the client IP in a header.
- **The origin secret is not a security boundary.** The Worker may add one, and Fastify
  may check it, but the Cloud Run origin stays publicly reachable. The owner's brief
  records that this neither prevents origin traffic nor its charges.
- **Canonical addresses stay the same:** `https://wally.luminull.com` for the web app,
  `https://api.wally.luminull.com` for REST and the MCP resource.
- **Release:**
  - Release stays tag-triggered and approved. Cloud Run deploys keylessly through
    Workload Identity Federation.
  - Cloudflare deploys use a scoped API token held as a GitHub environment secret: an
    account API token with Workers Scripts · Edit only.
  - A failed post-release smoke test restores the previous web deployment and Cloud Run
    revision.
- **Retirement:** the domain mapping and Firebase Hosting are retired once the cutover to
  the Workers is verified. Amended 2026-11-01: the owner chose no rollback window, since
  production had no users or data yet, so Firebase Hosting leaves the release in the same
  change that adds the Workers. Done on 2026-11-01: v0.13.0 deployed the Workers, the
  owner moved both hostnames to them, and the domain mapping was deleted. Firebase
  Hosting's site goes with the rest of Firebase in RFC-0011 workstream 6.

### Consequences

- Good: Firebase Hosting and the Preview mapping go away, and ingress stays free.
- Good: DNS, the web app and the API edge sit with one provider.
- Bad: ADR-0008 avoided long-lived credentials. The release now holds two: the
  Cloudflare token, and the database credential for migrations (ADR-0020). Both are
  scoped as narrowly as the provider allows, and their rotation is recorded in DEPLOY.
- Bad:
  - On Workers Free, every proxied request counts against 100,000 requests a day and
    10 ms of CPU per request (owner brief, citing
    [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)).
  - The Worker proof (2026-11-01) measured 0–2 ms of CPU per request, held 30–110 s
    responses through the proxy, and found a ceiling of about 125 s, after which Cloudflare
    answers 524. A 55 s assistant request fits.
- Neutral: rollback is `wrangler rollback` to one of a Worker's last 100 versions, static
  files included, scripted in `scripts/release-state.mjs`.

### Confirmation

The release fails if:

- the bundle does not target `https://api.wally.luminull.com`;
- either Worker's new version fails its smoke test on its preview URL, before it serves
  traffic;
- the production smoke test fails after deploy, in which case it also rolls back.

The two other confirmations were amended on 2026-11-01:

- **No cached private response:** the proxy sets `cache: 'no-store'` on every forwarded
  request, pinned by its unit tests. The Worker proof saw no response cached, even one marked
  `public, max-age=600`.
- **Long requests:** a release cannot make an authenticated assistant request without a
  production test account and AI spend on every release. The Worker proof's held responses
  stand in for it, and the owner asks one real question through the proxy at the cutover.
  Done on 2026-11-01: the assistant answered through the proxy, and so did a ChatGPT read.

## More information

- [Platform migration](../rfcs/RFC-0011-platform-migration.md), workstream 4.
- Deployment steps: [DEPLOY.md, Cloudflare: setup, cutover and after](../DEPLOY.md#cloudflare-setup-cutover-and-after).
