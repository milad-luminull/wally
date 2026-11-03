# Cloudflare edge: web app and API proxy (migration workstream 4) — design

> **Status:** approved by the owner, 2026-11-01. The proof ran the same day; its results are
> under Evidence.

Date: 2026-11-01. Workstream 4 of the [platform migration](../../rfcs/RFC-0011-platform-migration.md),
decided in [ADR-0022](../../adr/ADR-0022-cloudflare-pages-and-api-proxy.md). It includes the
Worker proof (RFC-0011 §5 item 5), which gates it.

## Intent

Today both public hostnames point at Google:

- `wally.luminull.com` is a DNS-only CNAME to Firebase Hosting (`luminull-wally.web.app`).
- `api.wally.luminull.com` is a DNS-only CNAME to `ghs.googlehosted.com`, which is a Cloud Run
  domain mapping. Domain mappings are a Preview feature (ADR-0015).

(Both checked with `dig` on 2026-11-01.)

After this workstream Cloudflare serves both hostnames:

- the web app as static files;
- the API through a Worker that only forwards to the Cloud Run service.

The addresses stay the same, and so do the bundle, CORS, the MCP resource URL and ChatGPT
connections. Firebase Hosting and the domain mapping are retired straight after: there is no rollback
window, because production has no users or data yet (owner, 2026-11-01).

This is the smallest workstream and is independent of the others. It ships as
its own release, after v0.12.0 (the PostgreSQL release) has gone out, so that a failure points
at one change.

## Goals

1. **Prove first.** A throwaway Worker on the Free plan shows three things:
   - it holds a 60 s origin response within the 10 ms CPU limit;
   - it streams without buffering;
   - it never caches.

   Nothing in production changes during the proof.

2. **Web app:** the SPA is served from Cloudflare, with deep links answering 200 and hashed
   assets cacheable.
3. **API proxy:** a Worker forwards every request on `api.wally.luminull.com` unchanged to the
   Cloud Run service URL.
4. **Release:** the tag-triggered, approved release deploys both, smoke-tests them, and rolls
   them back on failure, as it does for Cloud Run today.
5. **Cutover:** the owner switches the DNS once, by a written procedure that can be reversed in
   minutes until the old routes are deleted.
6. **Retirement, in the same PR:** Firebase Hosting, `firebase.json` and the Hosting release
   steps are removed. The owner deletes the domain mapping right after the cutover is verified.

## Non-goals

- **No change to the API's behaviour,** apart from what the domain guard checks. That covers
  routes, CORS, rate limits, `trustProxy` and MCP.
- **No streaming assistant.** Its replies stay single JSON responses (`generateText`). The
  proof only records whether streaming would pass, for later.
- **No origin secret.** ADR-0022 allows one but records that it is not a security boundary.
  Leaving it out is my call: it would be one more secret to rotate, and it protects nothing.
- **No Cloudflare features beyond hosting and Workers.** No WAF rules, rate limiting, Access,
  Tunnel or KV.
- **No Terraform yet.** Its scope is still open (RFC-0011 §8). The Cloudflare setup is done once
  in the dashboard and written down in DEPLOY.
- **No local Workers in the compose stack.** Local development and E2E stay as they are.

## Anti-goals

- **Any spend.**
  - Cloudflare Free and Workers Free only.
  - The proof's throwaway Cloud Run origin stays inside Google's free tier and is deleted the
    same day.
  - Workers Paid ($5/month) needs the owner's approval, as with any spend.
- **Logic in the proxy.** It never retries, rewrites bodies, authenticates, caches, logs request
  contents, or follows redirects (ADR-0022).
- **A cached private response,** anywhere: at Cloudflare or through a changed header.
- **Share-link tokens, bearer tokens or note text** appearing in a log that Wally did not have
  before.
- **A cutover that cannot be undone** until it has been verified.

## Constraints

### Workers Free

All figures are from the
[limits page](https://developers.cloudflare.com/workers/platform/limits/), read on 2026-11-01.

- **100,000 requests a day** per account, resetting at midnight UTC. Over the limit, requests
  get error 1027.
- The "fail open" mode is described for routes. The page does not say whether it applies to
  Custom Domains, so assume it does not: **over the limit, the API is down until midnight
  UTC.**
- **10 ms CPU** per request.
- **No wall-clock limit** while the client stays connected.
- **50 subrequests** per request.
- **100 MB request body** on the zone's Free plan. The API's own limit is 256 KB on `/mcp`.

### Static assets

[Static asset requests are "free and unlimited"](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/).
That holds unless a Worker script runs first, so the web Worker has no script.

### Caching

- [Cloudflare does not cache HTML or JSON by default](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/).
  It also does not cache `no-store` or `private` responses, or anything that is not a GET.
- [A Worker's `fetch` reads through its own zone's cache](https://developers.cloudflare.com/workers/reference/how-the-cache-works/),
  even for a URL on another site.
- So the proxy sets `cache: 'no-store'` on every forwarded request. It is one of the two
  [supported `cache` values](https://developers.cloudflare.com/workers/runtime-apis/request/).

  That way "never caches" does not depend on every API route setting the right header. Today
  only `/mcp` sets `Cache-Control: no-store`.

### Client IP

- For a subrequest to an origin outside Cloudflare,
  ["the Worker script controls the client IP headers"](https://developers.cloudflare.com/fundamentals/reference/http-headers/).
- Forwarding the incoming headers unchanged passes the visitor's `CF-Connecting-IP`. That
  satisfies ADR-0022's "passes the client IP in a header".
- The API does not trust it. The origin stays publicly reachable, so the header can be forged,
  and the API does not use client IPs for anything that matters today (`app.ts`, rate-limit
  key).

### Custom Domains

- [A Custom Domain cannot be created on a hostname with an existing CNAME](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/),
  so the cutover deletes the CNAME first.
- Cloudflare issues the certificate.
- A Worker on a Custom Domain can `fetch` an external origin.

### Rollback

- Workers roll back with `wrangler rollback` to any of the
  [last 100 versions](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/).
- [A version includes its static assets](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/).
- Pages rolls back through
  [an API call](https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/deployments/methods/rollback/)
  to any successful production deployment.

### Credentials

The rules below are ADR-0022's, and the owner's.

- **The Cloudflare API token:**
  - is an
    [account API token](https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/)
    (**Manage account → Account API tokens**), which Cloudflare recommends for CI/CD: it
    belongs to the account, not to a person;
  - has one permission, **Account · Workers Scripts · Edit**. The proof showed it is enough
    for every release step;
  - is the release's second long-lived credential;
  - is scoped to the account that holds the `luminull.com` zone, since a Custom Domain must
    be in the zone's account, and to deploying Workers only;
  - can therefore change any Worker in that account. Cloudflare's token scopes stop at the
    account;
  - is stored as a secret in the `production` environment;
  - has its rotation recorded in DEPLOY.
- **The owner creates the token and sets the secret.** No token passes through Claude.
- **The release does not edit DNS.** The token has no zone DNS permission.

### Delivery

One PR from `main`. There is no rollback window, so retirement is part of it.

No user flow changes, so no Playwright spec changes; the PR says so. CI must be green before a
PR is called ready.

**v0.12.0 (PostgreSQL) went live on 2026-11-01, before this PR.** RFC-0011 says workstream 4 can go first,
but not here, for two reasons:

- the two changes must ship in separate releases;
- the proxy's preview smoke test expects `database: "ok"` from `/health`, which only the
  PostgreSQL revision returns.

### Other constraints

- English identifiers (ADR-0014).
- Never name the owner's employer in the repo.

## Decided

### Part 1: the Worker proof (workstream 0, item 5)

The proof is a spike: throwaway code in the scratchpad, never committed. Its findings go into
RFC-0011 §5 and ADR-0022 in the PR.

**Who does what:**

- **The owner, once:**
  - signs in to Cloudflare with `wrangler login` on their machine;
  - deploys the throwaway origin with one `gcloud run deploy` command, which Claude provides.
    Deploy commands are the owner's to run.
- **Claude:**
  - deploys the proof Workers to `*.workers.dev` with the owner's login;
  - runs the measurements;
  - deletes the Workers afterwards.
- **The owner, for check 9:**
  - creates the scoped API token in the dashboard;
  - runs a script Claude provides in their own shell, entering the token with `read -rs`, so
    it never passes through Claude or shell history;
  - after the proof, stores that token as the release secret, or rolls it if it was exposed.
- **The owner, for check 10:** adds the test hostname `proof.wally.luminull.com` as a Custom
  Domain on the proof Worker, and removes it afterwards.
- **The owner** deletes the origin service afterwards.

**The throwaway origin, `wally-proof-origin`:**

- A Cloud Run service in `luminull-wally`, `europe-west1`, deployed with the same invoker
  setting as `wally-api`.
- About 30 lines of Node with no dependencies. It answers on any path:
  - with JSON echoing the method, the request headers it received, the body length, and a
    hit counter;
  - `?delay=N` waits N seconds before answering;
  - `?stream=N` sends one chunk every 5 s for N seconds;
  - `?cc=` sets `Cache-Control` to the given value.

**The proof Worker** is the proxy as specified in Part 2, with `ORIGIN` set to the throwaway
origin.

**What is measured, and what passes:**

| #   | Check                                                                                                                                                                    | Passes when                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Held responses: `delay` = 30, 60, 90, 110 and 130 s                                                                                                                      | 30 and 60 s complete with 200. Longer ones are recorded, which answers whether a ~100 s origin timeout applies to Worker subrequests                                                                                                          |
| 2   | CPU time of those requests, from the Worker's metrics in the dashboard                                                                                                   | Every one is under 10 ms                                                                                                                                                                                                                      |
| 3   | `stream=120`                                                                                                                                                             | The client receives chunks as they are sent, not all at the end                                                                                                                                                                               |
| 4   | Caching: GET twice each with `cc` absent, `public, max-age=600`, and `private`                                                                                           | The origin's hit counter rises on every request, and no `CF-Cache-Status: HIT` appears                                                                                                                                                        |
| 5   | Headers at the origin                                                                                                                                                    | `Authorization`, `Origin`, `Content-Type`, `Idempotency-Key`, `X-Expected-Revision` and `MCP-Protocol-Version` arrive unchanged, and `CF-Connecting-IP` is the caller's IP. `Host` and `X-Forwarded-For` are recorded                         |
| 6   | Methods and bodies: OPTIONS preflight, PATCH, DELETE, and a 256 KB POST                                                                                                  | Each arrives with the body intact, and the origin's status and headers come back unchanged                                                                                                                                                    |
| 7   | Origin unreachable (`ORIGIN` pointed at a closed host)                                                                                                                   | The client gets the proxy's 502 JSON body, not a Cloudflare error page                                                                                                                                                                        |
| 8   | Web: the built SPA as an assets-only Worker                                                                                                                              | `/` and `/boards/x` answer 200 with `index.html`. `/assets/*.js` carries its `_headers` cache rule. Deploy twice, `wrangler rollback`, and the first version's files are served again                                                         |
| 9   | Release mechanics with a token of the planned scope: upload a version, open its preview URL, deploy it, roll back                                                        | Each step works with that token alone; the minimal permission set is recorded                                                                                                                                                                 |
| 10  | The zone's security settings, through `proof.wally.luminull.com`: checks 4–6 again, from a server (curl, a non-browser `User-Agent`), and a POST shaped like an MCP call | No challenge, block or `cf-mitigated` header. The zone's Bot Fight Mode, AI-bot blocking, Security Level and Browser Integrity Check settings are recorded. Today both hostnames are DNS-only, so none of these settings applies to Wally yet |

**If a check fails:**

- **Check 1 at 60 s, or check 2 fails:** stop. The owner decides between the alternatives
  below. Nothing is quietly kept on Google.
  - Workers Paid, for its higher CPU limit.
  - Streaming the assistant.
  - Ingress some other way.
- **Check 10:** a challenge or block means a zone setting would stop ChatGPT's MCP calls, which
  come from servers, not browsers. The owner decides whether that setting is switched off. It
  covers every hostname on `luminull.com`, not only Wally's, and on the Free plan it cannot be
  scoped to one hostname. That limit is _unverified_ and is checked in the dashboard then.
- **Checks 3 to 9:** they change the design, not the decision. The design is updated and the
  owner is told what changed.

### Part 2: the API proxy Worker (`wally-api-proxy`)

**Where it lives:**

- A new workspace package, `apps/api-proxy`:
  - `src/index.ts`, the Worker;
  - `wrangler.jsonc`;
  - tests.
- Wrangler is pinned as a devDependency.
- Its `ORIGIN` variable is the Cloud Run service URL (`https://wally-api-….run.app`). It is not
  a secret.

**What it does, for every method and path:**

1. Builds the origin URL from `ORIGIN` plus the incoming path and query, unchanged.
2. Forwards a request with:
   - the incoming method, all incoming headers, and the body as a stream;
   - `redirect: 'manual'`;
   - `cache: 'no-store'`.
3. Returns the origin's response as it is: status, headers and a streamed body. No
   `await response.text()`, which would buffer.
4. If `fetch` throws, answers **502** with Wally's error shape and no other headers:
   `{"error":"INTERNAL_SERVER_ERROR","message":"Upstream unavailable","retryable":true}`.
   - The web app treats any 5xx as temporary (`apps/web/src/lib/errors.ts`).
   - Without CORS headers the browser reports a network error, which is also temporary.
   - **The proof showed `fetch` rarely throws.** When the origin cannot be reached, Cloudflare
     usually answers itself: 530 for a host that does not resolve, 524 after about 125 s
     without an answer. Those pages pass through as they are. They are 5xx without CORS
     headers, so the web app treats them as temporary too. Rewriting them would put logic in
     the proxy, so it does not.
5. Never retries. Writes are guarded by idempotency keys, but the proxy has no business
   deciding to send a request twice.

**What it does not do:**

- No telemetry: both `wrangler.jsonc` files set `send_metrics: false` and turn off
  `dependencies_instrumentation`.
- No logging. Workers Logs stay off, because request URLs can carry share-link tokens
  (`/share-links/<token>`), which the API redacts in its own logs.
- Request counts, errors and CPU time come from the dashboard's built-in metrics.

**Exposure:** `workers_dev` stays on, so each version has a URL the release can smoke-test.
That exposes nothing new: the Cloud Run URL is already public.

**Tests:** unit tests call the exported `fetch` handler with a stub `fetch`, and pin:

- the origin URL;
- the method;
- every header, byte for byte;
- the body passing through;
- `cache` and `redirect` on the forwarded request;
- the response returned as the same object, so it is not buffered;
- the 502 body;
- no retry after a failure.

### Part 3: the web app (`wally-web`)

**Workers static assets,** in a Worker of its own (`wally-web`) with no script. The owner chose
this on 2026-11-01 over Pages.

Why:

- **One mechanism.** Both deployables use the same release steps: `wrangler versions upload`,
  a preview URL, deploy and rollback. Pages would add `wrangler pages deploy` and a separate
  rollback API with its own deployment IDs.
- **Cloudflare's direction.** Its Pages documentation says "Start new projects with Workers"
  (RFC-0011 §7.2).
- **No coupling.** ADR-0022 set this option aside because it shared one Worker with the proxy.
  A Worker of its own removes that.
- **Free.** An assets-only Worker's requests are free and unlimited.

ADR-0022 allows either choice without a new ADR; its text is updated to name this one.

**Configuration**, in `apps/web/wrangler.jsonc`:

- `assets.directory` is `./dist`.
- `assets.not_found_handling` is `single-page-application`. Unknown paths answer 200 with
  `index.html`, as `firebase.json`'s rewrite does today.
- `apps/web/public/_headers` gives `/assets/*` the header
  `Cache-Control: public, max-age=31536000, immutable`.
- Everything else keeps the default `public, max-age=0, must-revalidate` with an ETag, so a
  release is seen on the next load.

**The bundle** is built in the release exactly as today, with the same checks for
`API_BASE_URL` and no `localhost:4000`.

### Part 4: the release

`release.yml` keeps its order and its "users never see an untested candidate" rule.

**Steps:**

1. **Verify, guards, and capture state (changed):**
   - `release-state.mjs snapshot` records the deployed version ID of `wally-api-proxy` and
     `wally-web`, instead of the Hosting version. It reads them with
     `wrangler deployments status --name <worker> --json` (confirmed by the proof).
   - `wrangler versions upload` refuses a Worker that does not exist yet (proof, check 9).
     So both Workers are created once, by hand, before the first release (DEPLOY), and the
     snapshot stops the release before any change if either is missing.
   - The snapshot also refuses while a Worker's active deployment still carries this
     release's tag as its message. The release deploys with the tag as the message and a
     rollback replaces it, so that state means an earlier run's recovery failed; recording it
     would make the failed version the rollback target. DEPLOY's "When a release fails"
     says how to put it right.
2. **Image, then migrations:** unchanged.
3. **Cloud Run candidate, no traffic, then its smoke test:** unchanged.
4. **Build and check the web bundle:** unchanged.
5. **New: upload both Workers as versions without deploying them**
   (`wrangler versions upload`), then smoke-test each through its preview URL:
   - the proxy's preview URL: `/health` answers `{status:"ok", database:"ok"}`;
     `/whiteboards` answers 401; an OPTIONS preflight from `https://wally.luminull.com` gets
     the right CORS headers; `/mcp` without a token answers 401 with `WWW-Authenticate`;
   - the web preview: `/` and `/boards/smoke-test` answer 200, and the entry bundle
     references `api.wally.luminull.com`.

   The proxy forwards to the service URL, which still serves the old revision at this point.
   That is fine, because the proxy does not depend on the revision.

6. **Shift Cloud Run traffic:** unchanged.
7. **New: deploy both uploaded versions** (`wrangler versions deploy`, 100%).
8. **Production smoke test** through the canonical hostnames: unchanged checks.
   - `check-api-domain.mjs` stops requiring a Ready domain mapping, and checks behaviour only:
     health, 401, CORS.
   - So it passes whichever edge serves the hostname. This lets the release ship before the
     cutover.
9. **Rollback on failure:**
   - `release-state.mjs apply` runs `wrangler rollback <captured version>` for each Worker that
     was deployed, in place of the Hosting restore.
   - It verifies the active version afterwards, as the Hosting restore does today.

**Firebase Hosting leaves the release in this same PR** (owner, 2026-11-01: no rollback window,
because production has no users or data yet).

- Between this release and the cutover, Firebase Hosting keeps serving v0.12.0's bundle. That
  bundle works with the API, because the API contract does not change.
- Removed in this PR:
  - the Hosting deploy step and `FIREBASE_TOOLS_VERSION`;
  - `firebase.json`;
  - the Hosting branch of `release-state.mjs`;
  - the `beta` gcloud component, which only the domain-mapping guard used.

**Secrets and variables:** the secret `CLOUDFLARE_API_TOKEN` and the variable
`CLOUDFLARE_ACCOUNT_ID`, both in the `production` environment.

### Part 5: cutover (owner, once, after the release is green)

**Before the cutover, zone security** (owner, 2026-11-01: keep protection where it is
recommended):

- **AI bot policies stay as they are.** On 2026-11-01 `luminull.com` allowed all three
  categories (Search, Training, Agents), and the dashboard marks "Allow (do not block)" as
  recommended for each. Under the owner's rule, nothing changes.
  - [Training blocking](https://developers.cloudflare.com/bots/additional-configurations/block-ai-bots/)
    targets bots "crawling for the purpose of AI training", not assistants acting for a user,
    so it would not affect Wally either way. It covers every hostname on `luminull.com`, which
    makes it the owner's choice for the whole domain, not this workstream's.
  - **Agents must stay allowed.** That category covers chat fetch bots and browser-use agents.
- **Bot Fight Mode** was on during the proof's check 10, with Browser Integrity Check on and
  Security Level "medium", and nothing was challenged. So it stays on, and the cutover's
  ChatGPT call is the last check. If that call is challenged, it is switched off.
  - Why it is watched:
    [Cloudflare's page](https://developers.cloudflare.com/bots/get-started/bot-fight-mode/)
    says it "may challenge API or mobile app traffic". It covers the whole domain, and Skip,
    Bypass and Allow rules have no effect on it.
  - Almost all of Wally's traffic is API traffic: the web app's calls and ChatGPT's MCP calls.
    The proof's requests came from a residential IP; ChatGPT's come from data centres.

**Procedure.** One sitting; the API first, then the web app. The exact clicks go in DEPLOY.

1. **API:**
   - Note the current CNAME for `api.wally.luminull.com`.
   - Delete it.
   - Add `api.wally.luminull.com` as a Custom Domain on `wally-api-proxy`.
   - Wait for the certificate.
   - Run the production smoke test by hand: `check-api-domain.mjs`, plus `curl -sI` showing
     `server: cloudflare`.
   - Then ask the assistant one real question (a few cents of Vertex). Its reply takes the
     longest request path end to end.
   - Then make one ChatGPT MCP call (a read).
2. **Web:** the same for `wally.luminull.com` on `wally-web`. Then sign in, open a board, and
   create and move a note.

**If something fails during the cutover:**

- Remove the Custom Domain and recreate the noted CNAME. Firebase Hosting still serves
  v0.12.0's bundle, and the domain mapping is still in place.
- That takes minutes and loses nothing. No data lives at the edge.

**Right after the cutover is verified** (no window, owner, 2026-11-01), the owner deletes:

- the Cloud Run domain mapping for `api.wally.luminull.com`;
- the custom domain on the Firebase Hosting site.

The Firebase Hosting site itself goes with the rest of Firebase in workstream 6.

### Part 6: docs (same PR)

- **DEPLOY:**
  - Cloudflare setup, the token and its rotation;
  - the zone security settings above;
  - cutover and its undo;
  - the deletions after it.
- **SETUP:** nothing changes locally; say so.
- **GDPR:** Cloudflare joins the processors. It now terminates TLS for API traffic, including
  bearer tokens and note text in transit.
- **The architecture overview.**
- **ADR-0022:**
  - Workers static assets chosen;
  - the Confirmation amended (Risks below).
- **RFC-0011:**
  - §5 item 5, with the proof's findings;
  - §4 status;
  - §8: correct the record that the owner's hand-run migration on 2026-10-31 went through the
    pooler. It used the direct host, which works only over IPv6. The release secret was
    switched to the transaction pooler on 2026-11-01, after v0.12.0's first two attempts
    failed safely at the migrations step.
- **The indexes:**
  - ADR-0022 and RFC-0011 status;
  - ADR-0015 marked retired;
  - the "In production" cells.

## Left to the builder

- **The proof origin's code,** and the exact measurement script.
- **The `wrangler` version and `compatibility_date`.** Settled in the plan: Wrangler 4.151.3 and
  `2026-10-26`, the newest date its runtime supports.
- **How `release-state.mjs` reads and restores Worker versions,** following the commands the
  proof confirmed. Unit tests in the style of `release-state.test.mjs`.
- **Whether the two Worker uploads share one job step.**
- **Wording in DEPLOY and GDPR.**

## Owner decisions (2026-11-01)

1. **Web hosting:** Workers static assets in their own Worker, not Pages.
2. **Rollback window:** none. Production has no users or data yet, so Firebase Hosting leaves
   the release in the same PR, and the old routes are deleted right after the cutover is
   verified.
3. **Cloudflare account:** the Workers go into the owner's own account, which holds
   `luminull.com`.
   - The deploy token can therefore change any other Worker in that account.
   - Moving the zone to the owner's separate, empty "luminull" account is possible later
     ([moving a domain](https://developers.cloudflare.com/fundamentals/manage-domains/move-domain/)).
     It means exporting and importing the DNS records, possibly a nameserver change at the
     registrar, and a short "Pending" period in which Cloudflare does not proxy.
   - Doing it later also means moving the two Workers, their Custom Domains and the token. It
     is not part of this workstream.
4. **Zone security:** keep the protection that is recommended. Applied to what the proof found
   (Part 5): the AI bot policies stay "Allow", which Cloudflare marks as recommended. Bot Fight
   Mode stays on unless the cutover's ChatGPT call is challenged.

## Risks

- **The 100,000-requests-a-day limit is a hard stop for the API,** if fail-open does not apply
  to Custom Domains.
  - Today's traffic is far below it.
  - Trigger: the dashboard shows more than 50,000 requests on any day. Then the owner decides
    on Workers Paid.
  - The proof cannot test the limit itself.
- **Cloudflare becomes a processor for API traffic** (see GDPR above).
- **ADR-0022's Confirmation** requires the release to fail "if a long assistant request does
  not complete through the proxy". A release cannot make an authenticated assistant request
  without a production test account and AI spend on every release.
  - **My call:** the proof's 60 s hold covers it, plus the owner's one real question at
    cutover.
  - ADR-0022's Confirmation is amended to say so in this PR.

## Evidence (read 2026-11-01)

- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Static assets billing and limitations](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
- [Static assets](https://developers.cloudflare.com/workers/static-assets/) (SPA not-found
  handling)
- [Static assets headers](https://developers.cloudflare.com/workers/static-assets/headers/)
  (`_headers`, default `max-age=0, must-revalidate`)
- [Default cache behavior](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/)
- [How the cache works with Workers](https://developers.cloudflare.com/workers/reference/how-the-cache-works/)
- [Request](https://developers.cloudflare.com/workers/runtime-apis/request/) (`cache` values)
- [HTTP headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/)
  (client IP in Worker subrequests)
- [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Rollbacks](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/),
  [versions and deployments](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/)
- [Pages limits](https://developers.cloudflare.com/pages/platform/limits/),
  [Pages rollbacks](https://developers.cloudflare.com/pages/configuration/rollbacks/),
  [Pages rollback API](https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/deployments/methods/rollback/)

### Proof results (2026-11-01)

The proof ran the real `apps/api-proxy` and `apps/web` code under throwaway names, against a
throwaway Cloud Run origin, on Workers Free. All ten checks passed or were resolved:

1. Held responses of 30, 60, 90 and 110 s answered 200. At 130 s Cloudflare answered 524 after
   about 125 s, so a Worker's origin request ends at roughly 125 s. Wally needs about 55 s.
2. CPU time was 0–2 ms per request, including the 60 s hold.
3. A streamed response arrived chunk by chunk, as sent.
4. Nothing was cached, even with `public, max-age=600`. `cache: 'no-store'` also adds
   `Cache-Control: no-cache` and `Pragma: no-cache` to the forwarded request.
5. Every API header arrived unchanged. `CF-Connecting-IP` is the caller's IP; `Host` is the
   origin's.
6. OPTIONS, PATCH, DELETE and a 256 KB POST arrived intact.
7. An unreachable origin gets Cloudflare's own error page, not the proxy's 502 (Part 2).
8. The assets-only Worker serves deep links with 200, applies `_headers`, does not serve
   `_headers` itself, and `wrangler rollback` restores the earlier version's files.
9. With only an account API token holding Workers Scripts · Edit: version upload, preview URLs
   (proxy and assets-only), `versions deploy`, `deployments status --json` and `rollback` all
   work. Uploading to a Worker that does not exist is refused.
10. Through `proof.wally.luminull.com`, with Bot Fight Mode, Browser Integrity Check and
    Security Level "medium" on: no challenge or block for non-browser clients or an MCP-shaped
    POST. These requests came from a residential IP, not a data centre, so the real ChatGPT
    call at cutover stays the last check (Part 5).

Deleting a Worker also removes its Custom Domain and DNS record.

### Still not verified first-hand

- **Fail-open:** whether it exists for Custom Domains. The proof cannot test the daily limit.
- **Custom Domains across deploys:** whether `wrangler versions deploy` leaves a
  dashboard-created Custom Domain in place when the config declares no routes. The first
  release after cutover shows it; the production smoke test fails if the domain is lost.
