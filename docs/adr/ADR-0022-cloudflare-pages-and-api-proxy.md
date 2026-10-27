# ADR-0022: Cloudflare Pages for the web app and a Worker proxy for the API domain

- **Status:** accepted
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
  - Cloudflare deploys use a scoped API token held as a GitHub environment secret.
  - A failed post-release smoke test restores the previous web deployment and Cloud Run
    revision.
- **Retirement:** the domain mapping and Firebase Hosting are retired after the first
  Cloudflare release has served through its rollback window.

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
  - Whether a 55 s assistant request fits inside that is _unverified_ until the
    [platform migration](../rfcs/RFC-0011-platform-migration.md) proof, section 5.
- Neutral: Pages rollback has to be checked and scripted in the hosting slice.

### Confirmation

The release fails if:

- the bundle does not target `https://api.wally.luminull.com`;
- the Worker serves a cached private response;
- a long assistant request does not complete through the proxy.

## More information

- [Platform migration](../rfcs/RFC-0011-platform-migration.md), workstream 4.
- Deployment steps: [DEPLOY.md](../DEPLOY.md), updated in the hosting slice.
