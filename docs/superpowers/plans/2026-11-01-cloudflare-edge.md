# Cloudflare edge (workstream 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cloudflare serves `wally.luminull.com` (static web app) and `api.wally.luminull.com`
(a forwarding Worker to Cloud Run), deployed and rolled back by the tag release; Firebase
Hosting and the domain-mapping guard leave the release.

**Architecture:** two Workers in the owner's Cloudflare account. `wally-api-proxy`
(`apps/api-proxy`) forwards every request unchanged to the Cloud Run service URL. `wally-web`
is an assets-only Worker configured in `apps/web/wrangler.jsonc`. The release uploads both as
versions, smoke-tests their preview URLs, deploys them after the Cloud Run traffic shift and
rolls them back with `wrangler rollback`. The proof (Task 3) runs these same two Workers under
throwaway names before anything else is built on them.

**Tech stack:** Cloudflare Workers Free, Wrangler 4.151.3, Vitest 3, Node `node:test` for
`scripts/`, GitHub Actions.

**Spec:** [the workstream 4 design](../specs/2026-11-01-cloudflare-edge-design.md), approved by
the owner on 2026-11-01, within [RFC-0011](../../rfcs/RFC-0011-platform-migration.md) and
[ADR-0022](../../adr/ADR-0022-cloudflare-pages-and-api-proxy.md).

**Execution:** native, in the session, no Workflow runs; one whole-branch review at the end.

## Global Constraints

- Wrangler is exactly `4.151.3` everywhere: both `devDependencies` and every `npx` command
  (released 2026-10-20; the newest, 4.156.0, is three days old).
- `compatibility_date` is `"2026-10-26"` (the newest the pinned runtime supports) in both `wrangler.jsonc` files.
- Both Workers: `workers_dev: true`, `preview_urls: true`, `observability: { enabled: false }`,
  `send_metrics: false`, `dependencies_instrumentation: { enabled: false }`.
  No routes in config: Custom Domains are added by the owner in the dashboard at cutover.
- Workers Free and Cloudflare Free only. Nothing is spent without the owner's approval.
- The proxy never retries, rewrites bodies, authenticates, caches, logs or follows redirects.
- 502 body, byte for byte:
  `{"error":"INTERNAL_SERVER_ERROR","message":"Upstream unavailable","retryable":true}`.
- Tokens and connection strings never pass through Claude. The owner enters any token with
  `read -rs` in their own shell.
- The owner runs every `gcloud ... deploy`, `gcloud ... delete`, dashboard change, merge, tag
  and approval. Claude deploys and deletes only the throwaway `wally-proof-*` Workers.
- English identifiers and test data. Never name the owner's employer.
- One PR from `main`, not stacked. CI green before the PR is called ready. No Playwright spec
  changes (no user flow changes); the PR says so.
- A new dependency needs a host install, a container install and an api image rebuild before
  `make test` sees it.

## Review Focus

1. **First release, Workers absent:** `versions upload` refuses a Worker that does not exist
   (proof, check 9), so both Workers are created once by hand (DEPLOY). If either is still
   missing, the snapshot stops the release before any change, with a message naming that
   setup step. Pinned in Task 4.
2. **Partial Workers deploy:** the proxy deploys and the web deploy fails. Rollback restores
   the proxy, and leaves the web Worker alone when its active version is still the snapshot's.
   Pinned in Task 4.
3. **Origin redirects and errors:** a 3xx from Cloud Run reaches the client as a 3xx, and a
   5xx as that 5xx, never as the proxy's 502. Pinned in Task 1.
4. **Paths that look odd:** `/share-links/<token>` with percent-encoding, `//` and a query
   string reach the origin byte for byte. Pinned in Task 1.
5. **A preview URL that cannot be read:** if the upload output has no preview URL, the release
   fails before traffic moves, never smoke-tests production instead. Pinned in Task 6.

---

### Task 0: Branch and commit the design

- [ ] **Step 1:** in `../wally-cloudflare-edge`, rename the branch and commit the spec and this
      plan:

```bash
git branch -m docs/cloudflare-edge-design feat/cloudflare-edge
git add docs/superpowers/specs/2026-11-01-cloudflare-edge-design.md docs/superpowers/plans/2026-11-01-cloudflare-edge.md
git commit -m "docs: Cloudflare edge design and plan (workstream 4)"
```

Expected: one commit on `feat/cloudflare-edge`, `git status` clean. Nothing is pushed.

### Task 1: The API proxy Worker (`apps/api-proxy`)

**Files:**

- Create: `apps/api-proxy/package.json`, `apps/api-proxy/tsconfig.json`,
  `apps/api-proxy/eslint.config.js`, `apps/api-proxy/vitest.config.ts`,
  `apps/api-proxy/wrangler.jsonc`, `apps/api-proxy/src/index.ts`,
  `apps/api-proxy/src/index.test.ts`
- Modify: `.gitignore` (add `.wrangler/` and `.dev.vars`), `pnpm-lock.yaml`

**Interfaces:**

- Produces: `export interface Env { ORIGIN: string }` and
  `export default { fetch(request: Request, env: Env): Promise<Response> }` in
  `src/index.ts`; package name `@wally/api-proxy`; scripts `test` (`vitest run`), `lint`
  (`eslint .`), `typecheck` (`tsc --noEmit`), `build`
  (`wrangler deploy --dry-run --outdir dist`, so CI's `turbo run build` bundles it without
  credentials).
- `wrangler.jsonc`: `name: "wally-api-proxy"`, `main: "src/index.ts"`, the Global Constraints
  keys, `vars.ORIGIN` = the output of
  `gcloud run services describe wally-api --region=europe-west1 --format='value(status.url)'`
  (read-only; ask the owner to run it if Claude's gcloud is not signed in).
- `tsconfig.json`: extends `@wally/config/tsconfig.base.json`, `lib: ["ES2022", "WebWorker"]`,
  `types: []`. No `@cloudflare/workers-types`: the Worker uses only standard `fetch`,
  `Request`, `Response` and `Headers`.
- devDependencies: `wrangler` `4.151.3` (exact), `vitest`, `typescript`, `eslint` at the
  versions `apps/api` uses, `@wally/config` `workspace:*`.

- [ ] **Step 1: Write the failing tests** in `src/index.test.ts`. Stub `fetch` with
      `vi.stubGlobal`. `ORIGIN = 'https://origin.example'`.

```ts
it('forwards to ORIGIN plus the path and query, byte for byte', ...)
  // '/share-links/a%2Fb?x=1&y=%20' -> 'https://origin.example/share-links/a%2Fb?x=1&y=%20'
  // '//boards'                     -> 'https://origin.example//boards'
it('forwards the method and every header unchanged', ...)
  // PATCH with Authorization, Origin, Content-Type, Idempotency-Key, X-Expected-Revision,
  // MCP-Protocol-Version, CF-Connecting-IP: each equal on the forwarded request
it('forwards a 256 KB POST body intact', ...)          // arrayBuffer() equal
it('forwards GET and HEAD without a body', ...)        // forwarded.body === null
it('never caches and never follows redirects', ...)    // forwarded.cache === 'no-store',
                                                        // forwarded.redirect === 'manual'
it("returns the origin's response object itself", ...) // expect(result).toBe(originResponse)
it('passes 302 and 503 from the origin through unchanged', ...) // same object, same status
it('answers 502 with the error body when the origin cannot be reached', ...)
  // status 502; await text() === the Global Constraints body;
  // content-type 'application/json'; no access-control-* header
it('does not retry after a failure', ...)              // fetch stub called exactly once
```

- [ ] **Step 2: Run them.** `pnpm install` (host), then
      `pnpm --filter @wally/api-proxy test`. Expected: FAIL, `src/index.ts` has no default export.
- [ ] **Step 3: Implement** `fetch(request, env)` in `src/index.ts`: build the URL with
      `env.ORIGIN + url.pathname + url.search` (string concatenation, not `new URL(path, base)`,
      which would rewrite `//`), forward with `new Request(target, request)` overridden by
      `{ redirect: 'manual', cache: 'no-store' }`, return the `fetch` result as is; on a rejected
      `fetch`, return `Response` with the 502 body and only `content-type: application/json`.
- [ ] **Step 4: Run them.** `pnpm --filter @wally/api-proxy test`. Expected: 9/9 PASS.
- [ ] **Step 5: Check the rest.** `pnpm --filter @wally/api-proxy typecheck lint build`.
      Expected: all pass; `apps/api-proxy/dist/index.js` exists. Then `pnpm run format:check`.
- [ ] **Step 6: Commit.** `git commit -m "feat(api-proxy): a Worker that forwards every request to Cloud Run unchanged"`

### Task 2: The web Worker config (`wally-web`)

**Files:**

- Create: `apps/web/wrangler.jsonc`, `apps/web/public/_headers`
- Modify: `apps/web/package.json` (devDependency `wrangler` `4.151.3`, exact), `pnpm-lock.yaml`

**Interfaces:**

- Produces: `wrangler.jsonc` with `name: "wally-web"`, no `main`, the Global Constraints keys,
  `assets: { directory: "./dist", not_found_handling: "single-page-application" }`.
- `_headers`, exactly:

```
/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

This is configuration, so there is no unit test. The behaviour is checked locally here, and on
Cloudflare by the proof's check 8.

- [ ] **Step 1:** create both files, `pnpm install`, then `pnpm --filter @wally/web build`.
      Expected: `apps/web/dist/_headers` exists.
- [ ] **Step 2:** `pnpm --filter @wally/web exec wrangler dev --port 8788` in the background,
      then:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8788/
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8788/boards/smoke-test
curl -sI "http://localhost:8788$(curl -s http://localhost:8788/ | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' | sed -n 1p)" | grep -i cache-control
```

Expected: `200`, `200`, `cache-control: public, max-age=31536000, immutable`. If local dev
ignores `_headers`, ledger it as a ruling and leave it to check 8. Stop the dev server.

- [ ] **Step 3:** `pnpm run format:check && pnpm --filter @wally/web typecheck lint`. Expected: pass.
- [ ] **Step 4: Commit.** `git commit -m "feat(web): serve the SPA as a Workers static-assets Worker"`

### Task 3: The Worker proof (owner and Claude, nothing in production changes)

Throwaway material lives in the scratchpad (`proof/`), never in the repo. Findings go into
`proof/findings.md` and the ledger, then into the docs in Task 7.

**Owner, first:**

- [ ] **Step 1:** `npx --yes wrangler@4.151.3 login`, then `npx --yes wrangler@4.151.3 whoami`.
      Expected: the account that holds `luminull.com` is listed; the owner tells Claude its
      account ID (not a secret). In the dashboard, **Workers & Pages** shows a `workers.dev`
      subdomain; if it asks to choose one, the owner chooses it.
- [ ] **Step 2:** Claude writes `proof/origin.js`: about 30 lines of dependency-free Node,
      `?delay`, `?stream`, `?cc`, a hit counter and a header echo (design Part 1). It also gives
      the owner one `gcloud run deploy wally-proof-origin` command that runs it on the public
      `node:22-alpine` image (`--command node` and the code as an argument), so nothing is built
      or stored. Flags: `--region europe-west1`, `--no-invoker-iam-check`, `--max-instances 1`,
      `--timeout 300`. The owner runs it.
      Expected: the owner gets a service URL, and `curl <url>/x` returns the echo JSON.

**Claude, with the owner's login:**

- [ ] **Step 3:** deploy the real code under throwaway names:

```bash
pnpm --filter @wally/api-proxy exec wrangler deploy --name wally-proof-proxy --var ORIGIN:<origin-url>
pnpm --filter @wally/web exec wrangler deploy --name wally-proof-web
```

- [ ] **Step 4:** run checks 1–8 from the design's table against the `workers.dev` URLs:
  - **Check 1:** run with `curl -w '%{http_code} %{time_total}'`.
  - **Check 2:** read CPU time from `wrangler tail wally-proof-proxy --format json` (`cpuTime`)
    while check 1 runs, or from the dashboard metrics.
  - **Check 3:** run with `curl -N` and timestamps per chunk.
  - **Check 7:** redeploy with `--var ORIGIN:https://127.0.0.1:9`.
  - **Check 8:** deploy the web Worker twice, with a visible change in the second build. Run
    `wrangler rollback` to the first version, then confirm the first build's entry file is
    served again.

  Expected: each check's "Passes when" column. **Stop rule:** if check 1 at 60 s or check 2
  fails, stop all tasks and tell the owner, with the numbers.

**Owner, check 9 (token):**

- [ ] **Step 5:** the owner creates an API token in the dashboard. Scope: the `luminull.com`
      account only, with **Account › Workers Scripts › Edit**. Claude writes
      `proof/token-check.sh`. It reads the token with `read -rs` and runs these steps, each with
      `WRANGLER_OUTPUT_FILE_PATH` set:
  1. `versions upload` to `wally-proof-proxy`;
  2. `versions upload` to a Worker name that does not exist yet, which answers Review Focus 1;
  3. `curl` of the preview URL;
  4. `versions deploy <id>@100% -y`;
  5. `deployments status --json`;
  6. `rollback <id> -y`.

  Every permission error is printed, and nothing secret is. The owner runs the script.
  Expected: every step succeeds with the token alone. If a step needs another permission, add
  only that one and re-run. Record:
  - the final permission set;
  - whether upload creates a missing Worker;
  - the output-file fields that carry the version ID and the preview URL;
  - the JSON shape of `deployments status`.

- [ ] **Step 6:** the owner keeps the token for the release secret, or rolls it if it was ever
      shown.

**Owner and Claude, check 10 (zone security):**

- [ ] **Step 7:** the owner adds `proof.wally.luminull.com` as a Custom Domain on
      `wally-proof-proxy`. They read out these settings for `luminull.com`:
  - Bot Fight Mode;
  - AI-bot blocking and its Agent policy;
  - Security Level;
  - Browser Integrity Check.

  Claude repeats checks 4–6 against it with `curl -A 'wally-proof/1'`, plus a JSON POST shaped
  like an MCP `tools/list` call. Expected: no challenge, no `cf-mitigated` header, and the
  origin echo comes back.

**Cleanup and record:**

- [ ] **Step 8:** Claude runs `wrangler delete` for `wally-proof-proxy`, `wally-proof-web` and
      any Worker that step 5 created. The owner then:
  - removes the test hostname, if it is still listed;
  - runs `gcloud run services delete wally-proof-origin --region europe-west1`;
  - runs `npx --yes wrangler@4.151.3 logout`.

  Expected: `wrangler whoami` with the token lists no `wally-proof-*` Worker.

- [ ] **Step 9:** write `proof/findings.md`: one line per check with the measured values, and
      the five "Not verified first-hand" items each answered. Ledger a ruling for every check
      3–10 that changes later tasks, especially the exact commands and fields Tasks 4 and 6 use.

### Task 4: `release-state.mjs` restores Workers instead of Hosting

**Files:**

- Modify: `scripts/release-state.mjs`, `scripts/release-state.test.mjs`

**Interfaces:**

- Consumes: the commands and JSON shapes recorded in Task 3, step 9.
- Produces: the state file
  `{ version: 2, project, region, revision, workers: { 'wally-api-proxy': string, 'wally-web': string }, commit }`.
  - `snapshotState(env, run)` returns it.
  - `applyState(state, run, { workers: boolean })` restores it.
  - CLI: `apply STATE.json [--workers]`.
  - Wrangler is run as `pnpm --filter <package> exec wrangler ...`, where the package is
    `@wally/api-proxy` or `@wally/web`.
  - `CLOUDFLARE_API_TOKEN` comes from the environment and never appears in arguments or
    output.
- Removed: `hostingApi`, `hostingVersion` and `--hosting`.

- [ ] **Step 1: Write the failing tests.** Rewrite the Hosting tests so the stub `run` answers
      `deployments status` per Worker:

```js
test('snapshot records the serving revision and each Worker version', ...)
test('snapshot refuses, naming the setup step, when a Worker does not exist', ...) // Review Focus 1
test('snapshot stops when a Worker read fails for any other reason', ...)
test('apply rolls back each Worker whose active version changed', ...)    // rollback <id>, then verified
test('apply skips a Worker still on its snapshot version', ...)           // Review Focus 2
test('apply leaves Workers alone without --workers', ...)
test('failed API recovery still attempts Worker recovery and reports failure', ...)
test('unexpected Worker readback cannot report recovery success', ...)
test('invalid snapshot performs no mutations', ...)                       // version 1 file is invalid
```

Keep the existing Cloud Run tests unchanged.

- [ ] **Step 2:** `node --test scripts/release-state.test.mjs`. Expected: FAIL on the new tests.
- [ ] **Step 3: Implement.** Read each Worker with
      `deployments status --name <worker> --json` (clean JSON on stdout,
      `versions: [{ version_id, percentage }]`); a missing Worker exits 1 with
      `[code: 10007]` on stderr. Version IDs must match `/^[0-9a-f-]{36}$/` before they are used.
- [ ] **Step 4:** `node --test scripts/release-state.test.mjs`. Expected: all PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(release): snapshot and roll back the Workers instead of Firebase Hosting"`

### Task 5: `check-api-domain.mjs` checks behaviour only

**Files:**

- Modify: `scripts/check-api-domain.mjs`, `scripts/check-api-domain.test.mjs`

**Interfaces:**

- Produces: the same health, 401 and CORS checks, with the `gcloud beta run domain-mappings`
  block removed.
  - `GCP_PROJECT_ID` and `GCP_REGION` are no longer required.
  - New optional `CHECK_URL`: the base URL to probe, defaulting to `API_BASE_URL`. That lets
    the release run the same checks against the proxy's preview URL.
  - `CHECK_URL` must start with `https://`.
  - Success message: `API health, authentication and CORS checks passed`.

- [ ] **Step 1: Write the failing tests:**

```js
test('passes on health, 401 and CORS without reading any domain mapping', ...) // no gcloud call
test('probes CHECK_URL when set, still requiring the canonical API_BASE_URL', ...)
test('rejects a CHECK_URL that is not https', ...)                              // no curl call
```

Delete the mapping-readiness cases. Keep the canonical-URL and CORS cases.

- [ ] **Step 2:** `node --test scripts/check-api-domain.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `node --test scripts/*.test.mjs`. Expected: all PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(release): check the API domain by behaviour, whichever edge serves it"`

### Task 6: The release workflow, and Firebase Hosting removed

**Files:**

- Modify:
  - `.github/workflows/release.yml`;
  - `.github/CODEOWNERS`: drop `/firebase.json`; add `/apps/api-proxy/` and
    `/apps/web/wrangler.jsonc`;
  - `apps/api/Dockerfile`: only if step 3 says so.
- Delete: `firebase.json`

**Interfaces:**

- Consumes: Task 3's output fields; Task 4's `apply ... --workers`; Task 5's `CHECK_URL`.
- Produces: a new secret `CLOUDFLARE_API_TOKEN` and a new variable `CLOUDFLARE_ACCOUNT_ID`, both
  in the `production` environment. The token is passed per step, to these steps only: the
  Cloudflare validation, the snapshot, the upload, the deploy and the rollback. The account ID
  is read in the deploy job's `env`, the job that declares the environment (final review).
  Telemetry is off in both `wrangler.jsonc` files (`send_metrics: false`), not by variable.

- [ ] **Step 1: Edit `release.yml`:**
  1. Drop `FIREBASE_TOOLS_VERSION` and `install_components: beta`. Fix the comments that
     mention Hosting, including the concurrency comment.
  2. Extend the rollout-switch validation: `CLOUDFLARE_ACCOUNT_ID` must match
     `^[0-9a-f]{32}$`, and the token must be non-empty.
  3. Snapshot step: pass the Cloudflare env.
  4. After "Verify what was baked into the bundle", add **"Upload the Workers as versions (no
     traffic)"** (`id: upload`). It does four things:
     - fails unless `apps/api-proxy/wrangler.jsonc`'s `ORIGIN` equals the service's
       `status.url`;
     - runs `versions upload --message "$GITHUB_REF_NAME"` for each Worker, with
       `WRANGLER_OUTPUT_FILE_PATH`;
     - reads the version ID and preview URL with `jq`;
     - fails if either is empty (Review Focus 5).

     Outputs: `proxy_version`, `proxy_preview`, `web_version`, `web_preview`.

  5. Add **"Smoke-test the Worker previews"**, retrying with `curl --retry 5` as the candidate
     check does.
     - **Proxy:** `/health` has `status` "ok" and `database` "ok". Then
       `CHECK_URL=<proxy_preview> node scripts/check-api-domain.mjs`. Then `POST /mcp` with no
       token answers 401 with a `WWW-Authenticate` containing `resource_metadata=`. MCP is
       always on in production (owner, 2026-11-01), so there is no disabled branch.
     - **Web:** `/` and `/boards/smoke-test` answer 200. The entry bundle references the API
       host, and its `cache-control` contains `immutable`.
  6. Replace "Deploy Firebase Hosting" with **"Deploy the Workers"** (`id: workers`), after the
     traffic shift: `versions deploy <id>@100% -y` for the proxy, then for the web Worker.
  7. Rollback step:
     `node scripts/release-state.mjs apply release-state.json ${{ steps.workers.outcome != 'skipped' && '--workers' || '' }}`.
  8. Summary: add both Worker version IDs.

- [ ] **Step 2: Validate the workflow:**

```bash
node -e "require('/Users/mr_user/development/apps/wally/node_modules/.pnpm/js-yaml@4.3.2/node_modules/js-yaml').load(require('fs').readFileSync('.github/workflows/release.yml','utf8'))" && echo parsed
grep -nE 'firebase|Hosting|beta|domain-mappings' .github/workflows/release.yml
```

Expected: `parsed`; the grep prints only `VITE_FIREBASE_*` lines, which are Firebase Auth and
stay.

- [ ] **Step 3: Check the API image still installs.**
      `docker build --target prod -f apps/api/Dockerfile -t wally-api:edge-check .`
      Expected: success. If it fails with an outdated-lockfile error, add
      `COPY apps/api-proxy/package.json apps/api-proxy/package.json` beside the
      `apps/web/package.json` copy in both stages, ledger it, and build again. Then run
      `make test` after the container install and image rebuild (Global Constraints).
      Expected: the whole suite passes, including `@wally/api-proxy`.
- [ ] **Step 4: Commit.** `git rm firebase.json`, then
      `git commit -m "feat(release)!: deploy the web app and API proxy to Cloudflare Workers; remove Firebase Hosting"`

### Task 7: Docs

**Files:** `docs/DEPLOY.md`, `docs/SETUP.md`, `docs/GDPR.md`, `docs/architecture/overview.md`,
`docs/README.md`, `README.md`, `docs/adr/ADR-0022-cloudflare-pages-and-api-proxy.md`,
`docs/adr/README.md`, `docs/rfcs/RFC-0011-platform-migration.md`, `docs/rfcs/README.md`

- [ ] **Step 1: Write each item in design Part 6, using Task 3's findings.** Additions:
  - **DEPLOY** gets a Cloudflare section covering:
    - the one-time setup: the account ID variable, the token with the permission set the proof
      found, the `production` secret, and token rotation;
    - the zone security settings;
    - the cutover and its undo;
    - the deletions after the cutover.

    Its §10 (web) and §13 (rollback) describe Workers, and its §14 (cost) adds Workers Free and
    the 50,000-a-day trigger.

  - **GDPR:** replace the Firebase Hosting request-log paragraph with Cloudflare's. Workers Logs
    are off, and what Cloudflare itself records goes in the open items as unverified until
    checked.
  - **README, docs/README and the indexes:** production runs v0.12.0 on PostgreSQL (true since
    2026-11-01, though the README still says v0.11.0). ADR-0022 and RFC-0011 workstream 4 read
    "built, not released"; the "live" cells change in a docs PR after the cutover.
- [ ] **Step 2:** `pnpm run format:check`, then
      `grep -rn "Firebase Hosting" README.md docs --include=*.md | grep -v superpowers`.
      Expected: format passes. Every remaining hit is history: ADRs 0008 and 0015, RFCs, and
      researches.
- [ ] **Step 3: Commit.** `git commit -m "docs: Cloudflare edge in DEPLOY, GDPR, architecture, ADR-0022 and RFC-0011"`

### Task 8: Review, PR, CI

- [ ] **Step 1:** the whole-branch review (executing-plans, final review), then its single fix
      pass.
- [ ] **Step 2:** push `feat/cloudflare-edge` and open the PR. The body covers:
  - what changes;
  - the proof's findings;
  - "No Playwright spec changes: no user flow changes";
  - the owner's steps before tagging: set the secret and the variable;
  - the cutover steps after.

  Bind the PR with the ccd_pr tools.

- [ ] **Step 3:** wait for CI to go green. Expected: all jobs pass, including `@wally/api-proxy`
      in test, lint, typecheck and build. Only then is the PR called ready.

### After merge (owner, with Claude checking)

1. The owner tags and approves the release. Claude reads the run and confirms these steps
   passed: the preview smoke, the Workers deploy and the production smoke.
2. The owner does the cutover from DEPLOY, API first. After each hostname, Claude checks it
   with `node scripts/check-api-domain.mjs` and `curl -sI`. The owner asks the assistant one
   real question and makes one ChatGPT read.
3. The owner deletes the domain mapping and the Hosting custom domain.
4. Claude opens a small docs PR that marks ADR-0022 and workstream 4 live and ADR-0015 retired.
