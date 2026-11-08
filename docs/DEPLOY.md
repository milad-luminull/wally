# Deploying Wally

A step-by-step guide to putting Wally on the internet, written for someone who has not
deployed to Google Cloud before. Every command is meant to be copy-pasted in order.

Budget about 45–90 minutes the first time. Most of it is waiting for builds.

> **Where production stands (2026-11-08).** Production runs v0.18.0: the API on Cloud Run
> in `luminull-wally-prod`, created with Terraform
> ([Infrastructure in Terraform](#infrastructure-in-terraform)), reads and writes Supabase
> PostgreSQL through the transaction pooler, and the edge is
> Cloudflare ([ADR-0022](adr/ADR-0022-cloudflare-pages-and-api-proxy.md)). The Worker
> `wally-web` serves the web app's static files at `wally.luminull.com`, and the Worker
> `wally-api-proxy` forwards `api.wally.luminull.com` to Cloud Run. The release deploys both
> Workers. The hostnames moved to them once, by hand, on 2026-11-01
> ([Cloudflare: setup, cutover and after](#cloudflare-setup-cutover-and-after)), and the
> Cloud Run domain mapping is deleted. Firebase is retired
> ([Firebase retired](#firebase-retired)).

## Lifecycle of a change

Every change takes the same path. The owner acts at the steps in bold; everything else
runs by itself.

1. **A pull request** against `main`. Its description's "After merge" section says what the
   merge will start: a Terraform plan, a release, or manual steps.
2. **CI** runs on it ([section 17](#17-continuous-integration)). A pull request that changes
   only files without app impact (documentation, Terraform, the Auth0 Action and a few
   others) skips the slow jobs
   ([ADR-0029](adr/ADR-0029-skip-slow-ci-jobs-on-pull-requests-without-app-impact.md)). The
   ruleset on `main` blocks the merge until the required checks pass.
3. **The owner merges.** The push to `main` runs CI again, in full.
4. If Terraform changed (`infra/terraform/wally/` or the Auth0 Action), the Infrastructure
   workflow plans at once and shows the plan in the run summary. **The owner reads it and
   approves "Approve the plan"**; Apply then applies exactly that plan
   ([Infrastructure in Terraform](#infrastructure-in-terraform)).
5. If app code changed (`apps/web`, `apps/api`, `apps/api-proxy`, `packages`), a `v*` tag is
   pushed, by the owner or by a Claude session the owner asked
   ([section 13](#13-deploying-again-later)).
6. **The owner approves the deploy** on the `production` environment. Then the change is
   live.

`make status` shows where things stand: open pull requests and their checks, runs waiting
for an approval, the last Terraform run on `main`, whether a release is due, and a list of
what is waiting on you. It only reads; it never approves, merges, tags or pushes. It needs
`gh` signed in as `milad-luminull` and `jq`.

---

## 1. What you are actually deploying

Wally is three separate things, and they go to three different places:

| Piece            | What it is                                                 | Where it goes                                                               |
| ---------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| `apps/web`       | A React app that compiles down to plain HTML/CSS/JS files  | **Cloudflare Worker `wally-web`**, static files only                        |
| `apps/api-proxy` | A few lines that forward every API request unchanged       | **Cloudflare Worker `wally-api-proxy`**, on `api.wally.luminull.com`        |
| `apps/api`       | A Fastify server that must stay running to answer requests | **Cloud Run** (runs a container for you), reached through `wally-api-proxy` |
| Your data        | Notes, boards, members                                     | **Supabase PostgreSQL** (Ireland, `eu-west-1`), reached only by the API     |

Plus configuration rather than code: **Auth0** (the only sign-in, for web and MCP, in
production, local development and CI; see [AUTH0.md](AUTH0.md)) and the **database
migrations** in `apps/api/drizzle/`, which ship inside the API image and run from it at
release. The planned move to Supabase and Cloudflare is in
[RFC-0011](rfcs/RFC-0011-platform-migration.md).

The flow once deployed:

```
Browser ──▶ wally-web (Cloudflare)       (serves the React app)
   │
   └──────▶ wally-api-proxy (Cloudflare) (forwards every request unchanged)
                 │
                 └──▶ Cloud Run          (the API; verifies the user's Auth0 access token)
                          │
                          └──▶ Supabase PostgreSQL (reads and writes the data, through
                                                    the transaction pooler)
```

**Why Cloud Run behind a Worker?** `apps/api` is a long-running server, so it needs
somewhere that runs a container; Cloud Run does, and scales to zero. The Worker in front
replaced Cloud Run's domain mapping, a Preview feature, as the way the API gets its own
hostname ([ADR-0022](adr/ADR-0022-cloudflare-pages-and-api-proxy.md)). It holds no logic.

---

## 2. Before you start

You need these installed on your machine. Check each one:

```bash
node --version     # must be 22 or newer
docker --version   # only needed if you want to test the prod image locally
gcloud --version   # Google Cloud CLI
```

If `gcloud` is missing, install the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install).
Then sign in; it opens a browser window:

```bash
gcloud auth login
```

Cloudflare's CLI, Wrangler, needs no install: it is a pinned dev dependency of `apps/web` and
`apps/api-proxy`, run with `pnpm --filter <package> exec wrangler`. Signing in to it is only
needed for the one-time setup in
[Cloudflare: setup, cutover and after](#cloudflare-setup-cutover-and-after).

### Names used throughout

These are already decided and deployed, and every command below has them filled in. They are
listed here so you recognise them when you see them, and so you know what to change if you
ever stand up a second environment.

| Name       | Meaning                                            | Value                 |
| ---------- | -------------------------------------------------- | --------------------- |
| Project ID | The Google Cloud project ID (not the display name) | `luminull-wally-prod` |
| Region     | The Google Cloud region everything is deployed to  | `europe-west1`        |
| Repo       | Artifact Registry repository holding the API image | `wally`               |

**One region, everywhere.** Mixing regions is the single most common cause of confusing
failures. `europe-west1` (Belgium) is a sensible default for a German company and is
supported by every service used here.

---

## 3. Step 1 — Create the project with Terraform

The Google Cloud project `luminull-wally-prod` and everything in it come from Terraform
([Infrastructure in Terraform](#infrastructure-in-terraform)). The owner applies the
bootstrap root once, from their machine: it creates the project, links it to the billing
account, enables the APIs Wally uses, sets a budget and creates the state bucket and
Terraform's own identity. The pipeline then applies everything else after the owner approves
each plan.

The budget is 10 units of the billing account's currency a month, with alerts at 50, 90 and
100 % ([`infra/terraform/bootstrap/main.tf`](../infra/terraform/bootstrap/main.tf)). Alerts
are not caps: billing is pay-as-you-go. See [section 14](#14-what-this-will-cost) for what
Wally realistically uses.

> **Never unlink billing.** On 2026-11-01 (20:49 UTC) the billing account was unlinked from
> the previous project, `luminull-wally`, by switching its Firebase plan to Spark, and Cloud
> Run stopped serving at once: the API answered 500 ("billing is disabled for this project"),
> then 429 and 503. Re-linking the account brought it back after about 28 minutes, within
> Google's documented delay: after billing is re-enabled, Cloud Run resources "might
> experience a delay of up to 30 minutes" before they serve again, and "there is no manual
> workaround" ([Cloud Run known issues](https://docs.cloud.google.com/run/docs/known-issues)).
> A release during that window fails its first check.

`luminull-wally`, the project that was set up by hand before Terraform, is retired
([Infrastructure in Terraform](#infrastructure-in-terraform)).

---

## 4. Step 2 — Create the database

**Done (2026-10-31), in production since v0.12.0.** The project is `wally` (ref
`jztzhyxshwgjrwscibly`) in Ireland (`eu-west-1`), on the Free plan, PostgreSQL 17.11.0.003,
the same image the local stack and CI run. It stays outside Terraform
([What stays outside Terraform](#what-stays-outside-terraform-and-how-it-is-checked)). Its
connection string is in Secret Manager (section 7). Nothing is bought without the owner's
approval.

1. Create a Supabase project. Wally's is in Ireland (`eu-west-1`; the owner's choice,
   RFC-0011 section 8). A region cannot be changed after creation.
2. Copy its **transaction pooler** connection string. That is the API's `DATABASE_URL`, and
   it goes into Secret Manager in section 7, never into a file or a plain variable.
3. Switch off the **Data API**, so only the API reads and writes tables
   ([securing your API](https://supabase.com/docs/guides/api/securing-your-api)). Whether
   Realtime keeps working with it off is an open proof (RFC-0011 section 5, item 3).

### Which connection the API uses

| Connection         | Port | Network                                 | Used for                                  |
| ------------------ | ---- | --------------------------------------- | ----------------------------------------- |
| Transaction pooler | 6543 | IPv4 on every plan                      | **The API**, and the release's migrations |
| Session pooler     | 5432 | IPv4 on every plan                      | Not used                                  |
| Direct connection  | 5432 | IPv6, or IPv4 with the paid IPv4 add-on | Not used                                  |

All three are described in Supabase's
[connecting guide](https://supabase.com/docs/guides/database/connecting-to-postgres). The
transaction pooler does not support prepared statements, so `createDatabase` in
[`apps/api/src/lib/postgres/client.ts`](../apps/api/src/lib/postgres/client.ts) turns them
off everywhere, locally too, as [Drizzle's Supabase guide](https://orm.drizzle.team/docs/connect-supabase)
advises.

Supabase recommends the direct connection for migrations. The release runs them from a
GitHub-hosted runner, which Supabase lists among services that only reach IPv4
([IPv4 and IPv6](https://supabase.com/docs/guides/troubleshooting/supabase--your-network-ipv4-and-ipv6-compatibility-cHe3BP)),
so it migrates through the same pooler URL the API uses. **Unverified:** that Drizzle's
migrator works through the transaction pooler. If it does not, the session pooler is the
IPv4 alternative, and the release would need a second secret.

### Row Level Security

Every one of the 19 tables has Row Level Security enabled and no policies
([`apps/api/drizzle/`](../apps/api/drizzle/)). PostgreSQL then denies every row to any role
that row security applies to ([row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)),
and Supabase asks for RLS on every table in an exposed schema
([RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)). The tables
belong to the role that ran the migrations, which is the role in `DATABASE_URL`, and table
owners bypass row security unless `FORCE ROW LEVEL SECURITY` is set, so the API is not
affected. This is a second lock beside the Data API switch. Authorization stays in the API.

### Backups

The Free plan has no managed backups ([backups](https://supabase.com/docs/guides/platform/backups)).
**There are none for now, by the owner's decision of 2026-10-31** (RFC-0011 section 8): data
lost on Supabase cannot be recovered. An encrypted nightly dump with a restore drill, or Pro's
daily backups, comes back when the owner decides.

### Keeping the database awake

Supabase pauses a Free plan project that "does not receive sufficient user database activity
over the past week"; "a few user requests to the database each day" is typically enough
([project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)). A
request to a paused project does not wake it. While it is paused the web app still loads, but
every API call that touches the database fails and `/health` answers 503.

**The keepalive.** [`.github/workflows/keepalive.yml`](../.github/workflows/keepalive.yml)
calls `https://api.wally.luminull.com/health` every 6 hours. `/health` runs one query against
the database, so that is four real queries a day, through the Cloudflare proxy and Cloud Run
like any user's request. It needs no secret and its token has no permissions. **Run workflow**
on the Actions tab runs it by hand.

- **A failed run** means `/health` did not answer 200 through three retries: the database was
  unreachable or paused, or Cloud Run was down. GitHub emails the person who last changed the
  workflow's schedule ([schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)).
- **Delays:** GitHub can delay scheduled runs under load, so the 6 hours are approximate.
- **It can switch itself off.** In a public repository, scheduled workflows are disabled after
  60 days without repository activity (same page). Turn it back on from the Actions tab.
- **It is not a guarantee.** Supabase does not say how much activity is enough. The backstop
  is Supabase's warning email to the project owner, about a week before a pause.

**If the project is paused anyway:** Supabase dashboard → the organization → `wally` →
**Resume project**. Data and settings come back. This works for 90 days after the pause; after
that the dashboard can no longer restore it, and the Free plan keeps no backup.

---

## 5. Step 3 — Application Default Credentials on Cloud Run

The API never uses a service-account key. On Cloud Run, Google hands the container
credentials automatically through **Application Default Credentials (ADC)**, so there is no
key to create, store, or rotate — and the organization blocks service-account key creation
(`iam.disableServiceAccountKeyCreation`) anyway.

The API uses these credentials for Vertex AI (section 9b). The database is not reached
with them: Cloud Run hands the API its `DATABASE_URL` from Secret Manager (section 7).

This is already handled in the code — no edits needed before you deploy:

- **`apps/api/src/lib/assistant/model/config.ts`** — the Vertex provider is created with
  no credentials, so it uses ADC: the Cloud Run runtime account, or a developer's
  `gcloud auth application-default login`.
- **`apps/api/src/lib/auth/auth0.ts`** — sign-in needs no Google credential: Auth0 access
  tokens are checked against Auth0's public keys. So the same code runs on Cloud Run, in
  compose and in CI without a key.
- **`apps/api/src/env.ts`** requires `DATABASE_URL`, and `ASSISTANT_VERTEX_PROJECT` when the
  assistant is on, and refuses to boot without them.

To double-check it still compiles:

```bash
docker compose run --rm api pnpm turbo run typecheck test
```

---

## 6. Step 4 — Point the CLIs at your project

From the repo root:

```bash
gcloud config set project luminull-wally-prod
gcloud auth application-default set-quota-project luminull-wally-prod
```

The second line makes the project the quota project of your Application Default Credentials
([`set-quota-project`](https://cloud.google.com/sdk/gcloud/reference/auth/application-default/set-quota-project)),
which local Vertex calls and Terraform's Google provider use.

There are no APIs to enable by hand: the bootstrap enables the ones Wally uses, listed in
[`infra/terraform/bootstrap/main.tf`](../infra/terraform/bootstrap/main.tf).

---

## 7. Step 5 — Store the secret values and apply the migrations

Terraform creates the two secrets, `wally-database-url` and
`wally-auth0-management-client-secret`, replicated only in `europe-west3`, and grants their
readers. It never holds their values, which the owner adds once
([Infrastructure in Terraform](#infrastructure-in-terraform), bootstrap step 5). Add the
transaction pooler URL from section 4 as a new version; `read -rs` keeps the password out of
your shell history:

```bash
read -rs DATABASE_URL
printf '%s' "$DATABASE_URL" | gcloud secrets versions add wally-database-url \
  --data-file=- --project=luminull-wally-prod
```

Two identities read it, each with `roles/secretmanager.secretAccessor` on this one secret, not
the project ([access control](https://docs.cloud.google.com/secret-manager/docs/access-control)),
both granted in [`infra/terraform/wally/google.tf`](../infra/terraform/wally/google.tf):

- **`wally-api`**, the runtime service account: Cloud Run reads the secret when an instance
  starts, and an instance whose secret cannot be read does not start
  ([Cloud Run secrets](https://docs.cloud.google.com/run/docs/configuring/services/secrets)).
- **`github-deployer`**, the release's identity: the "Apply database migrations" step reads
  the secret with `gcloud secrets versions access latest`.

### Applying the migrations

The SQL migrations live in [`apps/api/drizzle/`](../apps/api/drizzle/) and ship in the API
image at `/app/drizzle`. The server never migrates at boot. The release runs
`node dist/migrate-cli.js --require-purge-job` from the exact image it deploys, before the
candidate revision exists (section 13). The flag then checks that the hourly pg_cron job
`wally-purge-expired` exists and fails the release if it does not: the migration schedules it
only in pg_cron's own database and skips it silently anywhere else. By hand, with the image
you are about to deploy:

```bash
read -rs DATABASE_URL && export DATABASE_URL
docker run --rm -e DATABASE_URL \
  europe-west1-docker.pkg.dev/luminull-wally-prod/wally/wally-api@<digest> \
  node dist/migrate-cli.js --require-purge-job
```

**Every migration must keep working with the revision still serving.** The schema changes
before the new revision serves, and a failed release rolls back the API, never the schema:
there are no down migrations. Add before you remove, in separate releases. Every schema
change is a new migration file ([SETUP.md](SETUP.md#docker)).

---

## 8. Step 6 — Build the API container image

Cloud Run runs containers from **Artifact Registry**. Terraform creates the repository,
`europe-west1-docker.pkg.dev/luminull-wally-prod/wally`, and grants the release's identity
write access to it. The release builds the image on a GitHub runner and pushes it there
(section 13).

The API's Dockerfile lives at `apps/api/Dockerfile` but needs the **monorepo root** as its
build context: it copies `packages/shared` and the lockfile. Because `prod` is the last stage
in that Dockerfile, it is what gets built — no `--target` needed.

### Why not `gcloud run deploy --source`?

You will see that command in most tutorials. It does not work here. It looks for a
`Dockerfile` at the root of the directory you point it at, and there is no flag to point it
at a different path.

### Building by hand (break-glass)

Only when the release cannot run. From the repo root, with an account that may write to the
repository (Artifact Registry Writer), sign Docker in to Artifact Registry once
([Docker authentication](https://docs.cloud.google.com/artifact-registry/docs/docker/authentication))
and build for `linux/amd64`, the platform Cloud Run runs; an Apple Silicon Mac builds arm64
otherwise:

```bash
gcloud auth configure-docker europe-west1-docker.pkg.dev
docker buildx build --platform linux/amd64 -f apps/api/Dockerfile \
  -t europe-west1-docker.pkg.dev/luminull-wally-prod/wally/wally-api:manual-$(git rev-parse --short HEAD) \
  --push .
```

The `-f apps/api/Dockerfile ... .` is the important part: the Dockerfile comes from the
subdirectory, the build context is `.` (the repo root).

### If the build fails

- **`COPY packages/shared` fails:** you ran the build from a subdirectory. Run it from the
  repo root.
- **A `rootDir` TypeScript error:** `apps/api/tsconfig.build.json` sets `rootDir: "src"` and
  excludes `**/*.test.ts`, because test files import helpers from `test/`. Keep that exclude.

---

## 9. Step 7 — Deploy the API to Cloud Run

### 9a. The service accounts

Terraform creates both, with no keys
([`infra/terraform/wally/google.tf`](../infra/terraform/wally/google.tf)):

- **`wally-api`**, the runtime account Cloud Run runs the container as. It holds
  `roles/aiplatform.user` for Vertex AI and reads the secrets in section 7. It needs no
  database role.
- **`github-deployer`**, the release's identity, reached from GitHub Actions through Workload
  Identity Federation. It may act as `wally-api` only, deploy revisions
  (`roles/run.developer`) and push images.

> IAM changes take up to 5 minutes to take effect. If your first request fails with a
> permission error, wait and retry before assuming something is broken.

### 9b. Deploy

Terraform creates the Cloud Run service `wally-api` and leaves its image, variables and
traffic to the release. A new service starts with Google's sample container; see
[Infrastructure in Terraform](#infrastructure-in-terraform) for its first release.

By hand, `--set-env-vars` **replaces** the service's whole set of variables, and production
needs every one that `apiConfig` in
[`scripts/resolve-release-image.mjs`](../scripts/resolve-release-image.mjs) defines:
`NODE_ENV`, `CORS_ORIGIN`, `ASSISTANT_ENABLED`, `ASSISTANT_MODEL`,
`ASSISTANT_VERTEX_LOCATION`, `ASSISTANT_VERTEX_PROJECT`, `AUTH0_MANAGEMENT_CLIENT_ID`,
`AUTH0_SIGNUP_ENABLED`, `MCP_ENABLED`, `MCP_WRITES_ENABLED` and, when set, `MCP_CLIENT_ID`. A
hand-typed list drops one easily, and a dropped `AUTH0_SIGNUP_ENABLED` turns production
signup off. So build the flags with `apiConfig`, `runEnvFlag` and `runSecretsFlag`, the
functions the release uses. Compare the values below with `gh variable list` and
`gh variable list --env production` (which overrides it) before you deploy, and change any
that differ:

```bash
export GCP_PROJECT_ID=luminull-wally-prod WEB_ORIGIN=https://wally.luminull.com \
  ASSISTANT_ENABLED=true ASSISTANT_MODEL=vertex:gemini-3.8-flash ASSISTANT_VERTEX_LOCATION=eu \
  AUTH0_SIGNUP_ENABLED=true MCP_ENABLED=true MCP_WRITES_ENABLED=true \
  MCP_CLIENT_ID="$(gh variable get MCP_CLIENT_ID --env production)" \
  AUTH0_MANAGEMENT_CLIENT_ID="$(gh variable get AUTH0_MANAGEMENT_CLIENT_ID --env production)"
RUN_ENV=$(node --input-type=module -e "
  const { apiConfig, runEnvFlag } = await import('./scripts/resolve-release-image.mjs');
  console.log(runEnvFlag(apiConfig(process.env)));")
RUN_SECRETS=$(node --input-type=module -e "
  const { apiConfig, runSecretsFlag } = await import('./scripts/resolve-release-image.mjs');
  console.log(runSecretsFlag(apiConfig(process.env)));")
echo "$RUN_ENV"; echo "$RUN_SECRETS"   # check both before deploying

gcloud run deploy wally-api \
  --image=europe-west1-docker.pkg.dev/luminull-wally-prod/wally/wally-api:<tag> \
  --region=europe-west1 --project=luminull-wally-prod \
  --service-account=wally-api@luminull-wally-prod.iam.gserviceaccount.com \
  --set-env-vars="$RUN_ENV" \
  --set-secrets="$RUN_SECRETS"
```

Apply the migrations from the same image first (section 7).

If `MCP_CLIENT_ID` is ever unset, leave it out of the export entirely rather than exporting an
empty or placeholder value. `apiConfig` refuses a missing value, so a forgotten variable stops
here rather than in production.

Three things worth understanding:

- **`DATABASE_URL` is a secret, never a plain variable.** It carries the database password.
  `RUN_SECRETS` is `DATABASE_URL=wally-database-url:latest`: Cloud Run reads the secret's
  latest version when an instance starts. Google recommends pinning a version instead of
  `latest` for environment variables
  ([Cloud Run secrets](https://docs.cloud.google.com/run/docs/configuring/services/secrets));
  Wally does not pin yet.
- **`--set-secrets` replaces every secret, like `--set-env-vars`.** To change one, use
  `--update-secrets` (same page).
- **Do not set `PORT`.** Cloud Run injects it (8080), and the server already reads
  `env.PORT` and binds `0.0.0.0`. Setting it yourself is rejected.

A redeploy that passes only `--image` keeps the current variables. To change one variable,
use `--update-env-vars`, never `--set-env-vars` with a partial list. The next release
replaces the whole set from `apiConfig` anyway.

The assistant is off unless `ASSISTANT_ENABLED=true` is set. When it is on, `ASSISTANT_MODEL`
(`provider:model`, default `vertex:gemini-3.8-flash`), `ASSISTANT_VERTEX_LOCATION`
(default `eu`) and optionally `ASSISTANT_VERTEX_PROJECT` configure the route. The runtime
account's `roles/aiplatform.user` comes from Terraform.

`GET /health` reports the configured model without calling it. The release pipeline sets
`ASSISTANT_ENABLED`, `ASSISTANT_MODEL` and `ASSISTANT_VERTEX_LOCATION` from the repository
variables of the same names (`gh variable set ASSISTANT_ENABLED --body true`), with the
API's defaults when a variable is absent; a value set by hand on the service is replaced at
the next release.

The default is Gemini 3.8 Flash on the EU multi-region endpoint (location `eu`, served
at `aiplatform.eu.rep.googleapis.com`), which keeps processing in the EU (D4). In the
previous project the model answered 404 in `europe-west1`, `europe-west3` and
`europe-west4` (checked 2026-10-19). Gemini 2.5 Flash, the earlier default, was retired by
Google on 2026-10-20.

Two caps bound spend: `ASSISTANT_DAILY_CAP_TOKENS` (default `300000`) is each user's daily
token allowance on any key, and `ASSISTANT_MONTHLY_CAP_MICRO_USD` (default `15000000`, that
is 15 USD) is the monthly ceiling on the deployment key. The monthly cap is computed from
the price table in `apps/api/src/lib/assistant/budget/prices.ts`; check that table against
the vendor's pricing page before changing `ASSISTANT_MODEL`.

To call Vertex from a local machine, the API uses Application Default Credentials: run
`gcloud auth application-default login` with an account that has `roles/aiplatform.user` on
`luminull-wally-prod`, and set `ASSISTANT_VERTEX_PROJECT=luminull-wally-prod`. The compose
stack's `api` container gets the same login: `docker-compose.yml` mounts `~/.config/gcloud`
read-only at `/root/.config/gcloud`, the well-known place ADC reads it from
([ADC search order](https://docs.cloud.google.com/docs/authentication/application-default-credentials);
Google's [local container example](https://docs.cloud.google.com/run/docs/testing/local) mounts
the file read-only too). After a new login, restart the container. On Cloud Run the runtime
service account applies. One real turn can be run by hand, against whatever
database `DATABASE_URL` names:

```bash
pnpm --filter @wally/api assistant:smoke <uid> <boardId> "<question>"
```

### 9c. Make the service publicly reachable

Cloud Run puts **two independent gates** in front of the container:

1. **Cloud Run's own IAM invoker check** — the caller needs `roles/run.invoker`.
   `--allow-unauthenticated` is just shorthand for granting that role to the special
   `allUsers` principal.
2. **Wally's own authentication** — every route goes through the auth preHandler, which
   verifies an Auth0 access token and 401s without one.

Wally deliberately relies on gate 2. Gate 1 exists for service-to-service auth and is
redundant here — which is why making the service "public" does _not_ mean "no security".

This organization enforces **domain-restricted sharing**
(`constraints/iam.allowedPolicyMemberDomains`, limited to the Workspace customer ID). That
constraint exists precisely to stop public IAM bindings, and `allUsers` is not a domain, so
there is **no allowlist value that permits it** — the binding fails with:

```
FAILED_PRECONDITION: One or more users named in the policy do not belong to a permitted
customer, perhaps due to an organization policy.
```

So Terraform turns gate 1 off on this one service instead (`invoker_iam_disabled = true` in
[`google.tf`](../infra/terraform/wally/google.tf)), which is
[Google's documented answer](https://docs.cloud.google.com/run/docs/authenticating/public)
for exactly this situation and the same as `gcloud run services update --no-invoker-iam-check`.
No IAM binding is created, so domain-restricted sharing is never triggered, and the scope is
this single service.

> **Do not "fix" this by overriding the org policy to Allow All.** It works, but it disables
> domain-restricted sharing for the entire project, so any external identity could be
> granted any role on anything in it.

The service's URL, the `api_url` output of the `wally` root, is:

```
https://wally-api-ttkwy6mnka-ew.a.run.app
```

This native URL remains useful for diagnostics and tagged candidate checks. Cloud Run also
answers on a second, project-number-based hostname,
`https://wally-api-299735685184.europe-west1.run.app`; both reach the same service.

The production browser API URL is **`https://api.wally.luminull.com`**, with no trailing
slash. The `wally-api-proxy` Worker serves it, forwarding to the service's `status.url` (a
`run.app` URL).
That URL is written in `apps/api-proxy/wrangler.jsonc` as `ORIGIN`, and the release refuses
to ship a proxy whose `ORIGIN` no longer matches it.
The canonical web origin is **`https://wally.luminull.com`**.

Sanity check it is alive:

```bash
curl https://api.wally.luminull.com/health     # expect {"status":"ok","database":"ok","assistant":{"enabled":…,"model":"vertex:…"}}
curl -i https://api.wally.luminull.com/whiteboards | head -1   # expect HTTP/2 401
```

A 401 on the second one is _success_: the API is running and correctly refusing
unauthenticated access.

> **The health endpoint is `/health`, not `/healthz`, and that is deliberate.** Google Front
> End reserves the exact path `/healthz` on Cloud Run and answers it with its own 404 before
> the request reaches your container — Cloud Run treats paths ending in `z` as reserved.
> This is invisible locally (`docker compose` never goes through GFE),
> so it only shows up in production, as a Google-branded 404 page on one single path while
> every other route works. Do not name routes with a trailing `z`.

---

## 10. Step 8 — Build and deploy the web app

### 10a. Give the build its environment variables

This trips people up: Vite bakes `VITE_*` values into the JavaScript **at build time**, and
it reads them from `apps/web/.env*` — _not_ from the repo-root `.env` that docker-compose
uses. Build without them and you get a white screen and `auth/invalid-api-key` in the
console.

Create `apps/web/.env.production`:

```
VITE_API_BASE_URL=https://api.wally.luminull.com
VITE_AUTH0_CLIENT_ID=...
```

`VITE_AUTH0_CLIENT_ID` is the public SPA client id (the `VITE_AUTH0_CLIENT_ID` repository
variable), never a client secret. It is a public identifier — safe to ship to the browser,
because access is enforced by Auth0 and by the API, not by hiding it.

`VITE_API_BASE_URL` is the canonical API URL, `https://api.wally.luminull.com`, **with no trailing slash**.

This file contains no secrets, but it is environment-specific — and it **is** gitignored:
`.gitignore` covers `.env.*`, which matches `.env.production`. (`.dockerignore` excludes it
too, so the `apps/web` Docker `prod` stage cannot see it either.)

Do not commit it. CI does not use it at all: the release workflow supplies the same two
values from GitHub repository _variables_ — they are public identifiers baked into a public
bundle, so they are variables rather than secrets — and asserts afterwards that the built
bundle really does contain the production API URL and not `localhost:4000`.

### 10b. The web Worker's configuration

[`apps/web/wrangler.jsonc`](../apps/web/wrangler.jsonc) describes `wally-web`: a Worker with
no script that serves `apps/web/dist` as
[static assets](https://developers.cloudflare.com/workers/static-assets/).

- `not_found_handling: "single-page-application"` answers any unknown path with
  `index.html` and status 200. That is what makes React Router work: loading
  `https://wally.luminull.com/boards/123` directly would otherwise be a 404, because no such
  file exists.
- [`apps/web/public/_headers`](../apps/web/public/_headers) caches `/assets/*` for a year as
  `immutable`: those files are named by their content hash, so a new build never reuses a
  name. Everything else, `index.html` included, keeps Cloudflare's default
  `public, max-age=0, must-revalidate` with an ETag, so a release is seen on the next load.
- No script runs: static asset requests are free and unlimited on Workers Free only while
  no script runs first.

### 10c. Build and deploy

Normally the release does this (section 13). By hand, after the one-time setup:

```bash
pnpm --filter @wally/web build
pnpm --filter @wally/web exec wrangler deploy
```

The output ends with the Worker's `workers.dev` URL. The same Worker also answers on
`https://wally.luminull.com`.

> **The web build uses its own tsconfig, for the same reason the API does.** `build` runs
> `tsc -p tsconfig.build.json`, not `tsc -b`. The plain `tsc -b` walks the project
> references, which drags `src/**/*.test.tsx`, `vitest.config.ts` and the other tooling
> configs into a production build and fails it on test-only type errors. `tsconfig.build.json`
> extends `tsconfig.app.json` and excludes tests, so a deploy is blocked only by problems in
> code that actually ships.

Verify the build picked up the right environment before you deploy — the values are compiled
in, so a wrong one is baked into the bundle:

```bash
grep -c "api.wally.luminull.com" apps/web/dist/assets/*.js   # expect 1
grep -c "localhost:4000" apps/web/dist/assets/*.js                      # expect 0
```

---

## 11. Step 9 — Let Auth0 accept your web address

Auth0's hosted login sends people back only to addresses listed on the SPA client. Already
correct for this project: the client allows the callback, web origin and logout URL of
`https://wally.luminull.com` and of `http://localhost:5174`
([AUTH0.md](AUTH0.md#configuration)). The list is in
[`infra/terraform/wally/auth0.tf`](../infra/terraform/wally/auth0.tf) (`auth0_client.web`):
any other address you serve the web app from — another domain, or a second local copy on
another port — has to be added there and applied first, or sign-in stops at Auth0 with a
callback error. A change made in the Auth0 dashboard is reverted by the next apply.

### Check CORS matches

Production requires `CORS_ORIGIN=https://wally.luminull.com`. It must match the browser
origin **exactly**, including scheme and no trailing slash. The release sets it from the
`WEB_ORIGIN` variable through `apiConfig` (section 9b). To check the running service:

```bash
gcloud run services describe wally-api --region=europe-west1 --project=luminull-wally-prod \
  --format="value(spec.template.spec.containers[0].env)"
```

---

## 12. Step 10 — Verify it actually works

Open `https://wally.luminull.com` and walk through this list. Open your browser's developer
console (F12) first — most failures announce themselves there.

1. The sign-in page renders.
2. You can create an account and sign in.
3. The board loads (it will be empty — there is no seed data in production, by design).
4. Create a note. Reload the page; it is still there.
5. In the database (`psql` with the connection string from section 4),
   `select id, owner_id from whiteboards` shows a board whose `id` is your Wally user id (a
   random id created at your first sign-in, the same as your `users` row's), and
   `select title from notes` shows your note.
6. Drag a note between horizon zones, then open it and confirm the history shows the move.
7. Add a subtask, tick it, confirm the counter on the card updates.
8. Open **Teilen**, invite an email address, confirm the member appears as `PENDING`.

---

## 13. Deploying again later

**Normally you do not run any of this.** Push a `v*` tag and
[`.github/workflows/release.yml`](../.github/workflows/release.yml) performs every step
below, in the same order, then smoke-tests the result:

```bash
git tag v0.2.0 && git push origin v0.2.0
```

`make status` says whether a release is due and suggests the next tag. A Claude session may
push the tag when the owner asks it to (decided 2026-11-07). Pushing a tag deploys nothing
by itself: the run pauses on the `production` GitHub Environment until the owner approves
it, and that approval is the gate. It
authenticates with Workload Identity Federation, so there is no key to manage — which is
just as well, since the organization blocks service-account key creation entirely.

[The release guard](../scripts/check-api-domain.mjs) checks the API by behaviour, whichever
edge serves it: HTTPS health, unauthenticated 401, and a successful CORS preflight allowing
authorization and content-type from the canonical web origin. It runs before deployment,
against the proxy's preview URL (`CHECK_URL`), and again after promotion; a failure after
traffic shifts follows the existing rollback path. Run its
isolated regression suite locally with:

```bash
docker compose exec -T api node --test scripts/check-api-domain.test.mjs
```

What it does differently from the manual commands, and why:

- **Deploys by image digest, not by tag.** `:latest` is a mutable pointer; a digest is the
  artifact. Images are also tagged with the commit SHA and the semver.
- **Ships the API with `--no-traffic --tag=rel-<sha>` first**, smoke-tests that revision's
  own URL, and only then shifts traffic. A failed smoke test therefore needs no rollback —
  production never served the bad revision.
- **Applies the database migrations first**, from the exact image it is about to deploy and
  before the candidate revision exists (section 7). It reads `wally-database-url` with the
  deploy identity, so that identity needs `roles/secretmanager.secretAccessor` on the
  secret. A failed migration stops the release before Cloud Run changes.
- **Asserts the environment back** after deploying. `--set-env-vars` and `--set-secrets`
  replace the whole set, so the workflow re-reads the candidate and fails the release unless
  its variables are exactly `apiConfig`'s, `DATABASE_URL` comes from `wally-database-url` and
  `AUTH0_MANAGEMENT_CLIENT_SECRET` from `wally-auth0-management-client-secret`
  (`node scripts/resolve-release-image.mjs verify`).
- **Checks the deployed bundle** actually contains the production API URL and not
  `localhost:4000`.
- **Uploads both Workers as versions that serve no traffic** (`wrangler versions upload`)
  and smoke-tests each through its own preview URL before anything shifts: the proxy's
  `/health` (with `"database":"ok"`), 401, CORS and the `/mcp` challenge; the web app's `/`,
  a deep link, the API URL in its bundle and the `immutable` header on its assets. Only after
  the Cloud Run traffic shift does it deploy them (`wrangler versions deploy`, 100%).
- **Uses one Cloudflare credential,** the `CLOUDFLARE_API_TOKEN` secret, passed only to the
  steps that call Cloudflare.

### Rolling back

Automatic, if a smoke test fails after traffic moved. By hand:

```bash
# API — pick the previous revision
gcloud run services update-traffic wally-api --region=europe-west1 \
  --to-revisions=<previous-revision>=100
```

The Workers keep their last 100 versions, static files included. The release records the
version each Worker served before it started (`release-state.json`, kept as a workflow
artifact), and on failure rolls back only a Worker whose version changed. By hand:

```bash
# the version serving now, and the recent ones
pnpm --filter @wally/web exec wrangler deployments status --json
pnpm --filter @wally/web exec wrangler versions list
# go back to one of them
pnpm --filter @wally/web exec wrangler rollback <version-id> --message "rollback" -y
```

The same commands with `--filter @wally/api-proxy` roll back the proxy. **There is no
rollback to Firebase Hosting:** the owner chose no window (2026-11-01), because production
had no users or data yet, and the Hosting site is now disabled
([Firebase retired](#firebase-retired)).

### When a release fails

Where it stopped decides what happened, and what to do:

- **Before the traffic shift** (the guards, the migrations, the Cloud Run candidate or its
  smoke test, the bundle checks, the Worker uploads or their preview smoke test):
  production never changed. Migrations that ran stay applied, which is safe because every
  migration works with the revision still serving (section 7). Uploaded Worker versions
  take no traffic. Fix the cause, then rerun the run or push a new tag.
- **After the traffic shift:** the release restores what it recorded before it started
  (`release-state.json`, uploaded as the `release-state-<run>-<attempt>` artifact): the
  previous Cloud Run revision, and each Worker whose active version changed. The run's
  summary shows **Recovery: success**. Then fix and rerun, as above.
- **Recovery: failure** means production may be mixed: say, the old API with the new web
  app. The step's log names what failed. Put it right by hand from the artifact's values,
  then rerun:

  ```bash
  gh run download <run-id> --repo milad-luminull/wally --name release-state-<run-id>-<attempt>
  cat release-state.json      # revision, and workers: { wally-api-proxy, wally-web }
  gcloud run services update-traffic wally-api --region=europe-west1 --to-revisions=<revision>=100
  pnpm --filter @wally/api-proxy exec wrangler rollback <wally-api-proxy version> --message "Release rollback" -y
  pnpm --filter @wally/web exec wrangler rollback <wally-web version> --message "Release rollback" -y
  ```

  The Wrangler commands need `wrangler login`, or the token in `CLOUDFLARE_API_TOKEN` and
  the account ID in `CLOUDFLARE_ACCOUNT_ID`. Until production is back, a rerun refuses at
  "Capture the current production state": Cloud Run must not serve the failed release's
  revision, and no Worker may still carry the failed release's tag as its deployment
  message (the release deploys with the tag as the message; a rollback replaces it). This
  stops a rerun from recording the failed release as the state to go back to.

**A rollback reverts the API, never the schema.** There are no down migrations, so the
schema a release applied stays when its revision is rolled back. That is why every migration
must keep working with the revision before it (section 7).

**The smoke check reads the database.** `/health` runs one query and answers 503
(`"database":"unreachable"`) when the candidate cannot reach Supabase, and the smoke check
requires `"database":"ok"`, so such a candidate never takes traffic. A missing secret or grant
fails earlier: the revision does not start. v0.12.0 proved the path on 2026-11-01.

**Do not roll back past v0.12.0.** v0.11.0 reads Firestore, so nothing written to
PostgreSQL since is visible there. Fix forward.

**Do not roll a Worker back to a version older than v0.13.0's.** Each Worker's first
version was deployed by hand on 2026-11-01 to create it (`wally-web` 7ecc599e,
`wally-api-proxy` e420e600), and `wally-web`'s was built without production values, so it
cannot sign in or reach the API. `wrangler versions list` shows each version's message;
v0.13.0's are tagged `v0.13.0` (`wally-web` 5c3a20a1, `wally-api-proxy` 907ed2dc).

### The manual path (break-glass)

Still correct, and still what to reach for if Actions is down:

**Backend changed:** build and push the image by hand (section 8), then deploy it:

```bash
gcloud run deploy wally-api \
  --image=europe-west1-docker.pkg.dev/luminull-wally-prod/wally/wally-api:<tag> \
  --region=europe-west1 --project=luminull-wally-prod
```

**Frontend changed:**

```bash
pnpm --filter @wally/web build
pnpm --filter @wally/web exec wrangler deploy
```

**Proxy changed:** `pnpm --filter @wally/api-proxy exec wrangler deploy`.

Both need Wrangler signed in to the account (`wrangler login`), or `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` in the environment.

**Schema changed:** apply the migrations from the new image first (section 7), then deploy
the backend as above.

Cloud Run keeps every revision. If a deploy breaks production, roll back in the Cloud Run
console: select the service → **Revisions** → pick the previous one → **Manage traffic** →
send 100% to it. That is faster than rebuilding.

### Release with a data reset (ADR-0024)

Done on 2026-10-27 with v0.11.0. That release renamed the stored values to English
([ADR-0024](adr/ADR-0024-rename-persisted-values-without-migration.md)) with no migration:
every Firestore document in production was deleted instead. Before tagging, the owner
confirmed that `AUTH0_SIGNUP_ENABLED` was `true`, since after the delete every sign-in has to
create a new account. Right after the release workflow finished, the runbook deleted every
document in the `wally` database with this command, then checked in the Firebase console
that no collection remained:

```bash
npx --yes firebase-tools@15.30.2 firestore:delete --all-collections --database wally --project luminull-wally
```

Composite indexes, TTL
policies and rules are configuration, not documents, and stayed. A release before v0.11.0
cannot be rolled back to; fix forward. Locally, the database now lives in the
`postgres-data` volume and survives `make down`; `docker compose down -v` deletes it
([`docker compose down`](https://docs.docker.com/reference/cli/docker/compose/down/)), and
`make up && make seed` gives an empty database with the demo board.

---

## 14. What this will cost

For an app this size, realistically **near zero**, but Google Cloud bills "pay for what you
use" rather than "free with a hard cap", so it is worth knowing the shape.

The database is a Supabase project on the Free plan. Its budget is in
[RFC-0011](rfcs/RFC-0011-platform-migration.md) section 2, and the Free plan's catches (no
managed backups, a project that can pause) in its section 7. Nothing beyond Free is bought
without the owner's approval. Cloud Run scales to zero — you are billed per request and per second of execution, and
an idle service costs nothing.

Both Workers run on [Workers Free](https://developers.cloudflare.com/workers/platform/limits/).
Static asset requests are free and unlimited. Requests through `wally-api-proxy` count
against **100,000 a day** for the account, reset at midnight UTC, with 10 ms of CPU each (the
proof measured 0–2 ms). Over the limit, requests fail with error 1027; whether the API then
"fails open" is not documented for Custom Domains, so assume it is down until midnight UTC.
**When the dashboard shows more than 50,000 requests on any day,** the owner decides on
Workers Paid ($5/month).

The thing that would actually cost money is a runaway loop on Cloud Run or the assistant. That is
exactly what the budget alert in [section 3](#3-step-1--create-the-project-with-terraform)
is for.

---

## 15. Troubleshooting

**The new revision never starts, and its logs mention the secret**
Cloud Run could not read `wally-database-url`: the `wally-api` account lacks
`roles/secretmanager.secretAccessor` on it, or you are within the IAM propagation window.
The grant is in [`google.tf`](../infra/terraform/wally/google.tf); check the last
Infrastructure run applied it, and wait.

**"Apply database migrations" fails in the release**
The deploy identity cannot read the secret (section 7), or the runner cannot reach the
host. GitHub-hosted runners reach only IPv4, so the secret must hold a pooler URL, not the
direct connection (section 4).

**The API refuses to boot with `Invalid environment configuration: DATABASE_URL`**
`DATABASE_URL` is missing or not a URL. On Cloud Run it comes only from `--set-secrets`;
check the revision with
`gcloud run services describe wally-api --region=europe-west1 --project=luminull-wally-prod --format="value(spec.template.spec.containers[0].env)"`.

**The app calls `localhost:4000`, or signs in against the wrong Auth0 client**
The `VITE_*` variables were not present when you built. Confirm `apps/web/.env.production`
exists, then rebuild — the values are compiled in, so editing the file without rebuilding
changes nothing.

**Auth0 shows a callback URL mismatch when signing in**
Section 11 — add the address to the Auth0 SPA client in `auth0.tf`.

**CORS errors in the browser console**
`CORS_ORIGIN` on Cloud Run does not exactly match the origin the browser is using. Compare
them character by character, including `https://` and the absence of a trailing slash.

**Reading the actual logs** — this is the thing to reach for before guessing:

```bash
gcloud run services logs read wally-api --region=europe-west1 --project=luminull-wally-prod --limit=50
```

**A generic Google "Error 404 (Not Found)" HTML page instead of your app's response**
This is never your app's 404 — your app answers in JSON. It means the request was stopped
before it reached the container. Two different causes, and you tell them apart by _how many_
paths are affected:

- **Every path 404s** — the caller has no `roles/run.invoker`, so Cloud Run's front end
  refuses everything. (It returns 404 rather than 403 so it does not leak whether a private
  service exists.) Fix: section 9c, `invoker_iam_disabled` in Terraform. Check the current state with
  `gcloud run services describe wally-api --region=europe-west1 --project=luminull-wally-prod --format="value(metadata.annotations.'run.googleapis.com/invoker-iam-disabled')"`
  — `true` means the check is off.
- **Exactly one path 404s while the rest work** — you hit a Google Front End reserved path.
  `/healthz` is the one that bites here; paths ending in `z` are reserved on Cloud Run.
  Rename the route (this is why health lives at `/health`).

A response that actually reached your container carries a `Server: Google Frontend` header
and a JSON body. The front-end error page has neither — that header check is the fastest way
to tell where a response came from.

**Revision fails to start: `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`**
`node dist/server.js` tried to import `@wally/shared` as raw TypeScript. Node refuses to
strip types from anything resolved under `node_modules`, regardless of version or flags, and
pnpm links workspace packages there. The Dockerfile's build stage fixes this by running
`pnpm --filter @wally/shared build` and rewriting the deployed copy's `main`/`types`/
`exports` to its compiled `dist/`. The source-tree `packages/shared/package.json` is
deliberately left pointing at `src/` — `tsx` and Vite transform TypeScript themselves, so
local development is unaffected. If you add another workspace package as an API dependency,
it needs the same treatment.

---

## 16. What this guide does not cover

Deliberately out of scope, in rough order of when you will want them:

- ~~**Automated deploys from GitHub.**~~ Done — see section 13 and
  [`.github/workflows/`](../.github/workflows/). Everything above remains valid as the
  manual break-glass path.
- **A separate staging project.** The usual approach is a second Google Cloud project and a
  second pair of Workers with the same setup.
- **Seed data in production.** `make seed` writes fixture users that do not exist in any real
  sign-in provider into whatever `DATABASE_URL` names. The E2E and local MCP fixture seeds
  refuse a non-local database; the demo seed does not. Never run it with the production
  secret.
- **Backups.** None, by the owner's decision for now (section 4); nothing can be restored.

---

## 17. Continuous integration

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on every pull request and on
pushes to `main`, in six jobs:

| Job                                   | What it proves                                                                                                                                                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Lint & format**                     | `prettier --check` and `eslint` across the workspace.                                                                                                                                                                                                              |
| **Typecheck & build**                 | `turbo run typecheck build`. Both, because they use different tsconfigs — section 8 records a real case where typecheck was clean and the production build failed.                                                                                                 |
| **Unit & integration tests**          | Passes when both unit jobs passed: the API's Vitest suites against a `postgres` service on the same `supabase/postgres` image as compose, where each API test file clones its own database (ADR-0025); and the web and API-proxy suites, on a runner of their own. |
| **E2E (full stack)**                  | Playwright against a real `docker compose` stack.                                                                                                                                                                                                                  |
| **Detect changes without app impact** | Whether a pull request changes anything besides documentation, Terraform, the Auth0 Action and a few files no CI job reads (see below). Typecheck & build, the unit suites and E2E read it.                                                                        |
| **E2E gate**                          | Passes when E2E passed, or was skipped for a pull request without app impact; fails otherwise. See below.                                                                                                                                                          |

### Two things about the E2E job that are easy to get wrong

**It runs against the stack's own database, not production.** Every spec writes real data,
and `share.spec.ts` creates an invite on each run. Against production those records would
accumulate in the live database forever. The compose stack runs its own PostgreSQL, created
fresh on the runner, while sign-in still goes through real Auth0, so the coverage is genuine
and the data is disposable. Production only ever gets read-only smoke checks.

**A green E2E job is not automatically a meaningful one.** Every spec opens with
`test.skip(!hasE2eCredentials, …)`, so a missing secret produces a passing run that tested
nothing. The workflow parses Playwright's JSON report and fails if any test reported
`skipped`, if fewer than `MIN_EXECUTED` (27: 1 under setup, 24 under chromium-desktop, 1
under mobile-list-only and 1 under account-deletion) executed, or if fewer than four projects
produced results.

### Pull requests without app impact

When every file a pull request changes is a `*.md` file, sits under `docs/` or
`infra/terraform/`, or is `infra/auth0-post-login.cjs`, `.github/workflows/infrastructure.yml`,
`.github/workflows/keepalive.yml`, `apps/web/wrangler.jsonc` or `.gitignore`, nothing CI builds
or tests can change. Typecheck & build, the unit suites and E2E are skipped, and `E2E gate`
passes, saying why. Lint & format still runs, so Markdown is still format-checked and the
Auth0 Action's test (`scripts/auth0-post-login.test.mjs`) still runs; Terraform gets its own
`Format and validate` check from the Infrastructure workflow. Any other file runs everything,
including `ci.yml`, `release.yml`, `.github/actions/` and `apps/api-proxy/wrangler.jsonc` (the
proxy's build reads it).
Pushes to `main` always run everything, because the release workflow requires `main`'s full CI
run before it deploys. The reasoning is in
[ADR-0029](adr/ADR-0029-skip-slow-ci-jobs-on-pull-requests-without-app-impact.md), which
widened [ADR-0012](adr/ADR-0012-skip-e2e-on-documentation-only-pull-requests.md).

### Required checks on `main`

A repository ruleset, managed by Terraform (`github_repository_ruleset.main` in
[`infra/terraform/wally/github.tf`](../infra/terraform/wally/github.tf)), makes `main` change
only through a pull request whose `E2E gate`, `Lint & format`, `Typecheck & build` and
`Unit & integration tests` checks passed. A skipped check counts as passed, which is what lets
the skips above through. No approving review is required, because the owner opens and merges
their own pull requests. The owner, as the repository's admin, may bypass the ruleset on a
pull request, for a fix while CI is red for an outside reason; GitHub records each bypass.
Direct pushes and force pushes to `main` are refused. Tags are not covered: the release's own
gate is the `production` approval.

### Pull requests from forks

The repository is public, so anyone can open a pull request. GitHub withholds secrets from
fork PRs, which is the desired behaviour — but it means the E2E job cannot run. It is
therefore skipped there, and a separate **`E2E gate`** job fails with an explanation.

`E2E gate` is the required status check, **not** `E2E (full stack)`: a skipped required
check counts as passing, which would let exactly the least-trusted pull requests merge with
no end-to-end coverage at all.

### Configuration

The repository variables below, except the E2E account variables, and the `production`
environment's variables come from Terraform
([`infra/terraform/wally/github.tf`](../infra/terraform/wally/github.tf)); change them there.
The E2E variables and every secret are set by hand
([What stays outside Terraform](#what-stays-outside-terraform-and-how-it-is-checked)).

**Repository variables** — public identifiers, not secrets. They are compiled into a bundle
that anyone can download, so hiding them would buy nothing:

`GCP_PROJECT_ID`, `GCP_REGION`, `GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA`, `API_BASE_URL`,
`WEB_ORIGIN`, `VITE_AUTH0_CLIENT_ID`, and the E2E account variables `E2E_AUTH0_SUBJECT`,
`E2E_AUTH0_EMAIL`, `E2E_AUTH0_DEPENDABOT_SUBJECT` and `E2E_AUTH0_DEPENDABOT_EMAIL`.

**Auth0/MCP variables:** production runs with `AUTH0_SIGNUP_ENABLED`, `MCP_ENABLED` and
`MCP_WRITES_ENABLED` set to `true`, and `VITE_AUTH0_CLIENT_ID` and `MCP_CLIENT_ID` set to
the public SPA and MCP client IDs. `AUTH0_MANAGEMENT_CLIENT_ID` is the account-deletion
client's ID ([account deletion setup](#account-deletion-setup)); `apiConfig` refuses a
release without it. Unset, the switches default to `false`; the release
refuses to build without `VITE_AUTH0_CLIENT_ID`. Both client IDs are
public identifiers, never client secrets. The release validates combinations before any
deployment and reads the exact API flags and client ID back after deployment. Missing
MCP client IDs are omitted from Cloud Run rather than deployed as empty strings.

The issuer `https://login.luminull.com/` and REST audience
`https://api.wally.luminull.com` are fixed in the API (`apps/api/src/lib/auth/constants.ts`), not set by the release.
The web bundle receives the SPA client ID at build time; changing repository variables does
not change a deployed bundle. These switches do not provision Auth0 tenant
settings or grant connector access; see [AUTH0.md](AUTH0.md).

**Repository secrets:** `E2E_AUTH0_USER_PASSWORD` is the password of the Auth0 test account
CI signs in with; its email and subject are the repository variables above. Keep a separate
password under that same secret name in Dependabot secrets, alongside its separate account
variables. See the [E2E setup](../apps/web/e2e/README.md) for the isolated HTTPS routing.

**Cloudflare, on the `production` environment:** the secret `CLOUDFLARE_API_TOKEN` and the
variable `CLOUDFLARE_ACCOUNT_ID`, set by hand
([Cloudflare: setup, cutover and after](#cloudflare-setup-cutover-and-after)). The release
validates both before any change.

> There is deliberately **no service-account key anywhere.** The organization enforces
> `iam.disableServiceAccountKeyCreation`, and the API never uses one: ADC on Cloud Run, and
> nothing elsewhere, since verifying a token needs no credential (section 5). Two
> credentials are long-lived: the database password, in Secret Manager (section 7), and
> the Cloudflare release token.

### Why traces are disabled in CI

A Playwright trace records every action's input value verbatim, including
`getByLabel('Passwort').fill(PASSWORD)` in `e2e/support.ts`, plus full request bodies and
`Authorization` headers. Actions artifacts on a public repository are downloadable by anyone
with the run URL, and GitHub's log masking does not apply to artifact contents. So
`playwright.config.ts` sets `trace: 'off'` and `video: 'off'` under CI, and the workflow
uploads only `playwright-report/` — never `test-results/`. If you ever turn traces back on,
rotate the E2E password afterwards.

## Board safety rollout

Board commands, revisions and receipts ([ADR-0010](adr/ADR-0010-board-commands-revisions-and-receipts.md))
are live since v0.3.3; the one-time rollout steps are done. What stays:

**Expiry.** Six tables carry an `expires_at` column: `board_operations`, `assistant_audit`,
`assistant_conversations`, `assistant_attempts`, `assistant_suggestions` and
`assistant_tidies`. The database function `purge_expired()` deletes every row past it, and
the Supabase Cron (pg_cron) job `wally-purge-expired` runs it every hour, inside PostgreSQL.
They replace the Firestore TTL policies. `board_cleanup` has no expiry and the purge never
touches it. Seven days (receipts, assistant attempts, and assistant suggestions and tidies)
and 30 days (assistant audit records, and assistant conversations after their last turn) are
retention targets, not exact erasure times. Since migration `0005_retention.sql` the same
function also deletes expired share links with the members who joined through them, pending
invites 30 days after the invite, and `assistant_usage` days older than 30 days
([GDPR.md](GDPR.md#retention-periods-owner-2026-11-04)); `0003` added the one-hour
`deleted_identities` tombstones.

Both come from a SQL migration in [`apps/api/drizzle/`](../apps/api/drizzle/), so the release
creates them with the rest of the schema. Supabase enables pg_cron with
`create extension pg_cron with schema pg_catalog`
([Supabase Cron](https://supabase.com/docs/guides/cron/install)) and schedules jobs with
`cron.schedule` ([quickstart](https://supabase.com/docs/guides/cron/quickstart)). pg_cron
runs in one database, `cron.database_name`, which defaults to `postgres`, and a job runs in
the database where `cron.schedule` was called ([pg_cron](https://github.com/citusdata/pg_cron)).
So the migration (`0001_purge_expired.sql`) schedules the job, at minute 17 of every hour,
only in that database, and the per-file test databases skip it. It also revokes `execute` on
the function from `public`, `anon`, `authenticated` and `service_role`. On 2026-10-31 the job
was checked on a fresh `supabase/postgres:17.11.0.003` container: scheduled as `postgres` in
database `postgres`, and a run succeeded. **To confirm in the hosted project (proofs
slice):** that Supabase Cron is available on the Free plan. The owner says it is; the two
Supabase Cron pages above do not say.

**Maintenance.** `pnpm --filter @wally/api maintenance` runs the same purge on demand and
reports how many cleanup jobs are pending; `--cleanup` also drains them. There is no dry
run: a plain run deletes expired rows. Locally:

```bash
docker compose exec api pnpm --filter @wally/api maintenance
docker compose exec api pnpm --filter @wally/api maintenance --cleanup
```

With the production API image and `DATABASE_URL` from the secret, the compiled entry point
is `node dist/maintenance.js`, with the same flag. `--apply`, the old role-cache
reconciliation, is gone: roles and the share-link token are read from their own rows, so
there is no cache to repair. The command exits nonzero when requested cleanup remains
pending. Run it after any `cleanup_pending` outcome and monitor the remaining count; jobs do
not expire until completed. A repeated deletion request also retries its cleanup while its
receipt is retained.

## Cloudflare: setup, cutover and after

The web app and the API's hostname are served by two Workers in the Cloudflare account that
holds `luminull.com` ([ADR-0022](adr/ADR-0022-cloudflare-pages-and-api-proxy.md), the
[workstream 4 design](superpowers/specs/2026-11-01-cloudflare-edge-design.md)). Both are on
Workers Free, with `workers.dev` URLs under `luminull.workers.dev`.

### One-time setup (owner)

1. **Create the release token.** In the dashboard, select the account, then **Manage
   account → Account API tokens → Create Token**. An
   [account API token](https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/)
   belongs to the account rather than a person, which is what Cloudflare recommends for CI.
   Give it one permission, **Account · Workers Scripts · Edit**, on this account only, and an
   expiry of one year. The Worker proof showed that permission covers every release step:
   upload, preview URLs, deploy, status and rollback. It can change any Worker in the account;
   token scopes stop at the account. It has no DNS permission, so the release never edits DNS.
2. **Store it** as the secret `CLOUDFLARE_API_TOKEN` on the `production` GitHub environment,
   without it passing through anyone else:

   ```bash
   read -rs TOKEN && printf '%s' "$TOKEN" | gh secret set CLOUDFLARE_API_TOKEN --env production --repo milad-luminull/wally; unset TOKEN
   ```

   and the account ID, which is not a secret, as a variable on the same environment:

   ```bash
   gh variable set CLOUDFLARE_ACCOUNT_ID --env production --repo milad-luminull/wally --body <account-id>
   ```

3. **Create both Workers once.** `wrangler versions upload`, which the release uses, refuses
   a Worker that does not exist yet, and the release stops at "Capture the current
   production state" if either is missing. From an up-to-date `main`, signed in with
   `npx --yes wrangler@4.151.3 login` (or with the token in the environment):

   ```bash
   pnpm --filter @wally/api-proxy exec wrangler deploy
   pnpm --filter @wally/web build
   pnpm --filter @wally/web exec wrangler deploy
   ```

   Until the cutover these answered only on their `workers.dev` URLs, which no one used. So
   the web build needed no production values: the first release replaced it with the
   production bundle before any hostname pointed at it. Done on 2026-11-01.

**Rotating the token:** create a new one the same way, replace the secret with the command
above, run a release, then delete the old token. Record the new expiry date here.

- Current token: created 2026-11-01; expiry not recorded yet.

### Zone security for `luminull.com`

These settings apply to every hostname on the zone, not only Wally's. As found on
2026-11-01, and kept:

- **Bot Fight Mode: off** (since 2026-11-01). Cloudflare
  [warns](https://developers.cloudflare.com/bots/get-started/bot-fight-mode/) it "may
  challenge API or mobile app traffic", and it cannot be skipped by WAF custom rules or Page
  Rules. The Worker proof saw no challenge from a home IP, but the first release through
  Cloudflare (v0.14.0) did: Bot Fight Mode answered the GitHub runner's
  `curl https://api.wally.luminull.com/health` (Microsoft network, AS8075) with a managed
  challenge, rule `bot_fight_mode`, and the release stopped at its domain check. Every caller
  of the API is a program (the web app, MCP clients such as ChatGPT, the release), and the API
  needs an Auth0 token on every route and has its own rate limits, so it stays off. Bot
  filtering with exceptions would need Super Bot Fight Mode, which supports Skip rules but
  needs a paid plan (not checked; the owner decides).
- **Browser Integrity Check: on. Security Level: medium.** No challenge in the proof or in
  the v0.14.0 release.
- **AI bot policies (Search, Training, Agents): Allow**, which the dashboard marks as
  recommended. **Agents must stay allowed:** that category covers assistants fetching on a
  person's behalf.

### Cutover (done 2026-11-01)

Done by the owner after v0.13.0 deployed both Workers, and every check below passed. Each
Custom Domain's certificate was ready about two minutes after it was added. The steps stay
as the record, and as the way to attach a hostname to a Worker again.

One sitting: the API first, then the web app. Both hostnames were DNS-only CNAMEs to Google,
and a Custom Domain cannot be created on a hostname that has a CNAME, so each step deleted
the record first.

1. **API.**
   1. In **DNS**, note the record `api.wally` → `ghs.googlehosted.com` (DNS only), then
      delete it.
   2. Open **Workers & Pages → wally-api-proxy → Domains → Add → domain** and enter
      `api.wally.luminull.com`. (Cloudflare's docs still call this **Domains & Routes → Add →
      Custom Domain**. The account sidebar's **Domains → Add a domain** is a different thing:
      it adds a whole new zone.) Cloudflare creates the DNS record and the certificate within
      a few minutes.
   3. Check it:

      ```bash
      API_BASE_URL=https://api.wally.luminull.com WEB_ORIGIN=https://wally.luminull.com node scripts/check-api-domain.mjs
      curl -sI https://api.wally.luminull.com/health | grep -i '^server'   # expect server: cloudflare
      ```

   4. Ask the assistant one real question in the web app (a few cents of Vertex): its reply
      is the longest request path, end to end. Then make one read through ChatGPT's Wally
      connection.

2. **Web.** The same for `wally` → `luminull-wally.web.app` on `wally-web`, with hostname
   `wally.luminull.com`. Then sign in, open a board, create a note and move it.

**Undo** was possible until the clean-up below: remove the Custom Domain and recreate the
noted CNAME. With the domain mapping deleted there is no way back to Google's edge; a bad
Worker version is rolled back instead (section 13, rollback).

### After the cutover (done 2026-11-01)

Done straight away, since there is no rollback window (owner, 2026-11-01):

```bash
gcloud beta run domain-mappings delete --domain=api.wally.luminull.com --region=europe-west1 --project=luminull-wally
```

and in the Firebase console, **Hosting → wally.luminull.com → Remove**. The release no longer
deploys to Firebase Hosting, so its deploy identity no longer needs the Hosting role:

```bash
gcloud projects remove-iam-policy-binding luminull-wally --member=serviceAccount:github-deployer@luminull-wally.iam.gserviceaccount.com --role=roles/firebasehosting.admin --condition=None
```

The same clean-up removed three custom roles the deploy identity no longer used, and deleted
them from the project: `wallyReleaseDomainRead` (the release's domain-mapping guard, removed
in v0.13.0), and `wallyScheduleDeployment` and `wallyCleanupJobIam` (the
[account-cleanup worker](#account-cleanup-worker-retired)). Afterwards the deploy identity
holds `roles/run.developer`, `roles/serviceusage.serviceUsageConsumer`,
`roles/firebaserules.admin` and `roles/datastore.indexAdmin`; the last two go with Firestore
([Firebase retired](#firebase-retired)).

Firebase Hosting still listed `wally.luminull.com` as a custom domain after the console
removal (checked 2026-11-01). It served nothing, since DNS points at Cloudflare; it is deleted
with the rest of Firebase ([Firebase retired](#firebase-retired)).

### How the edge behaves

- **The proxy holds no logic.** It forwards the method, every header, the path, the query and
  the body unchanged to `ORIGIN`, never caches (`cache: 'no-store'`, which also adds
  `Cache-Control: no-cache` and `Pragma: no-cache` to the forwarded request), never follows
  redirects and never retries. The caller's IP reaches the API as `CF-Connecting-IP`; the API
  does not trust it, because the origin stays publicly reachable.
- **Errors.** If the origin cannot be reached, Cloudflare usually answers itself: 530 for a
  host that does not resolve, 524 when the origin has not answered within about 125 s. The
  proxy's own 502 (`{"error":"INTERNAL_SERVER_ERROR",...,"retryable":true}`) covers only a
  connection that fails outright. The web app treats every one of these as temporary.
- **No logs.** Workers Logs are off on both Workers: request URLs can carry share-link
  tokens, which the API redacts in its own logs. Request counts, errors and CPU time are in
  the dashboard's metrics.
- **No telemetry.** Both `wrangler.jsonc` files set `send_metrics: false` and turn off
  `dependencies_instrumentation`, so Wrangler sends Cloudflare neither usage data nor the
  list of npm dependencies, locally or in CI.
- **Not yet verified:** whether a release (`wrangler versions deploy`) keeps a Custom Domain
  added in the dashboard. The first release after the cutover shows it, and its production
  smoke test fails if the hostname was lost.

## Firebase retired

Wally no longer uses Firebase (RFC-0011 workstream 6;
[design](superpowers/specs/2026-11-01-retire-firebase-design.md)). Data has been on Supabase
PostgreSQL since v0.12.0 and the web app on Cloudflare since v0.13.0. v0.14.0 (2026-11-01)
removed Firebase Authentication, the local and CI sign-in, so Auth0 signs in everywhere. Nothing
was carried over from Firestore: PostgreSQL started empty
([RFC-0011](rfcs/RFC-0011-platform-migration.md) section 1).

The owner deleted the resources in three groups, each checked read-only afterwards. The
design holds the exact commands.

| Group                | Resource                                                                                                                                                                                                                                                    | Action                           | Done and checked |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ---------------- |
| A, any time          | Firestore database `wally` (`europe-west3`), with its indexes and TTL policies                                                                                                                                                                              | deleted                          | 2026-11-01       |
| A                    | Hosting custom domain `wally.luminull.com`                                                                                                                                                                                                                  | deleted (restorable for 30 days) | 2026-11-01       |
| A                    | Hosting default site `luminull-wally`                                                                                                                                                                                                                       | disabled                         | 2026-11-01       |
| A                    | `roles/firebaserules.admin` and `roles/datastore.indexAdmin` on `github-deployer`; `roles/datastore.user` on `wally-api`                                                                                                                                    | removed                          | 2026-11-01       |
| B, after the merge   | Firebase Auth accounts, email/password and Google sign-in                                                                                                                                                                                                   | deleted, turned off              | 2026-11-01 ¹     |
| B                    | Web app registration and its browser API key                                                                                                                                                                                                                | removed (restorable for 30 days) | 2026-11-01       |
| B                    | Service account `firebase-adminsdk-fbsvc`, its user-managed key and roles                                                                                                                                                                                   | deleted                          | 2026-11-01       |
| B                    | Firebase product APIs (`identitytoolkit`, `securetoken`, `firebasehosting`, `firebaserules`, `firestore`, `fcm`, `fcmregistrations`, `firebaseinstallations`, `firebaseremoteconfig`, `firebaseremoteconfigrealtime`, `firebaseappdistribution`, `testing`) | disabled                         | 2026-11-01       |
| B                    | GitHub variables `FIREBASE_PROJECT_ID` and `VITE_FIREBASE_*`, secrets `E2E_USER_EMAIL` and `E2E_USER_PASSWORD` (repository and Dependabot), label `auth0-validation`                                                                                        | deleted                          | 2026-11-01       |
| C, after the release | Production variables `AUTH0_ENABLED` and `VITE_AUTH_PROVIDER`                                                                                                                                                                                               | deleted                          | 2026-11-01       |

¹ Confirmed by the owner. It could not be read back: Identity Toolkit was already disabled
when it was checked.

The browser API key refused deletion because it had been used in the last 7 days (by local
development and CI, until the merge); `gcloud services api-keys delete` with
`--no-check-existing-usage` deleted it. The deleted service account also held
`roles/aiplatform.user` and `roles/iam.serviceAccountTokenCreator`; both grants were removed.

**What stays, by necessity:**

- **The Google Cloud project.** Cloud Run, Artifact Registry, Secret Manager, Workload
  Identity Federation and Vertex AI live in it, and Firebase cannot be taken out of it: Google
  documents that "once you 'add Firebase' to an existing Google Cloud project, it can't be
  undone" ([existing Cloud project](https://firebase.google.com/docs/projects/use-firebase-with-existing-cloud-project)).
  `firebase.googleapis.com` stays enabled, because Google warns that disabling the services
  "add Firebase" enabled "could cause unexpected and unintended consequences due to
  dependencies".
- **The default Hosting site, disabled.** Google documents that "you cannot delete the default
  site" ([multiple sites](https://firebase.google.com/docs/hosting/multisites)). A
  `SITE_DISABLE` release makes Hosting act as if the site never existed; its old versions,
  the public web bundle, stay stored.
- **`datastore.googleapis.com`, enabled.** Disabling it fails: Google's `cloudapis.googleapis.com`
  bundle depends on it, and forcing it would disable that bundle too. It serves nothing: the
  Firestore database is deleted and no account holds a Datastore role.
- **Two Google-managed role grants,** `roles/firebase.managementServiceAgent` and
  `roles/firebaserules.system`. They belong to Google's own service agents, which came with
  adding Firebase, not to any of Wally's accounts.
- **The billing link.** Cloud Run, Artifact Registry, Secret Manager and Vertex AI need it
  (section 3).

**Rolling back the API by Cloud Run revision still works,** because earlier revisions carry
their own environment. A revision older than v0.14.0 would accept Firebase ID tokens again,
but none can be issued any more: Firebase sign-in is off and its accounts are deleted.
Rolling back past v0.12.0 was already ruled out (section 13). The old path was never used in
production: a Firebase uid is 28 characters, while every Auth0 signup gets a UUID, and this
count returned 0 on 2026-11-01:

```sql
select count(*) from users
where id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
```

## Account deletion and export

Signed-in people export their data and delete their account on the **Account and data**
page ([design](superpowers/specs/2026-11-03-account-deletion-and-export-design.md),
[GDPR.md](GDPR.md) GAP-01 and GAP-02). Deletion deletes the Auth0 user first, then the Wally
data ([AUTH0.md](AUTH0.md#account-deletion)).

### Account deletion setup

Once, by the owner, **before the release that ships it**: the production API refuses to
start without the client, and the release refuses to build without its ID.

1. **Auth0:** a **Machine to Machine** application for the **Auth0 Management API** with
   only the **`delete:users`** permission. It is `auth0_client.account_deletion` with its
   grant in [`auth0.tf`](../infra/terraform/wally/auth0.tf). Under Applications → APIs →
   Auth0 Management API, the **Identifier** must read
   `https://dev-4tuhqfy0z1yepp5h.eu.auth0.com/api/v2/` (`AUTH0_TENANT_DOMAIN` in
   [constants.ts](../apps/api/src/lib/auth/constants.ts)).
2. **The secret's value.** Terraform creates the secret, in the EU like the database URL,
   read only by the runtime service account (the release does not read it). Add the client's
   secret as a version:

   ```bash
   read -rs AUTH0_MANAGEMENT_CLIENT_SECRET
   printf '%s' "$AUTH0_MANAGEMENT_CLIENT_SECRET" | gcloud secrets versions add \
     wally-auth0-management-client-secret --data-file=- --project=luminull-wally-prod
   ```

3. **The client ID** as a production variable:

   ```bash
   gh variable set AUTH0_MANAGEMENT_CLIENT_ID --env production --body '<client id>'
   ```

4. **The orphan check.** The release adds foreign keys from every user ID column to `users`,
   and adding one checks every existing row. In the Supabase SQL editor, this read-only query
   must return 0 in every row; otherwise the migration fails and the release stops with
   nothing changed. Clean up any row it finds first.

   ```sql
   select 'whiteboards.owner_id' as ref, count(*) from whiteboards t
     where not exists (select 1 from users u where u.id = t.owner_id)
   union all select 'notes.created_by_id', count(*) from notes t
     where t.created_by_id is not null and not exists (select 1 from users u where u.id = t.created_by_id)
   union all select 'notes.assignee_id', count(*) from notes t
     where t.assignee_id is not null and not exists (select 1 from users u where u.id = t.assignee_id)
   union all select 'note_history.actor_id', count(*) from note_history t
     where t.actor_id is not null and not exists (select 1 from users u where u.id = t.actor_id)
   union all select 'board_members.user_id', count(*) from board_members t
     where t.user_id is not null and not exists (select 1 from users u where u.id = t.user_id)
   union all select 'assistant_audit.actor_id', count(*) from assistant_audit t
     where not exists (select 1 from users u where u.id = t.actor_id);
   ```

### Proof after the release

CI and local runs never call Auth0, so the token exchange and the delete first run in
production. Right after the release (done for v0.16.0 on 2026-11-05, all five checks passed):

1. Sign up at `https://wally.luminull.com` with a throwaway address, and create a note.
2. **Account and data** → **Download my data**: the file holds the profile and the note.
3. **Delete account**, type the address, confirm. The app lands on the login page with "Your
   account is deleted."
4. Auth0 Dashboard → User Management → Users: the throwaway user is gone.
5. In the SQL editor, `select count(*) from users where email = '<throwaway address>'`
   returns 0.

### Deleting an account by hand

For someone who has lost their login, or to finish a deletion whose database step failed
after Auth0 (the API logs `account erase failed` with the `userId`):

1. Auth0 Dashboard → User Management → Users → the person → **Delete**, unless the log says
   the Auth0 step already happened.
2. In the Supabase SQL editor, find the Wally user ID (emails are not unique, so check the
   creation date with the person), then erase. The foreign keys remove everything else, as
   `DELETE /me` does ([erase.ts](../apps/api/src/lib/account/erase.ts)); their notes go
   first because a private note must keep an assignee:

   ```sql
   select id, email, created_at from users where email = lower('<address>');

   begin;
   delete from notes where created_by_id = '<user id>';
   delete from users where id = '<user id>';
   commit;
   ```

## Account-cleanup worker (retired)

Removed in PR #76 with self-service account export and deletion; its cloud resources and its
`accountDeletionJobs` and `accountDenials` collections were deleted on 2026-10-27.

## Infrastructure in Terraform

Wally's infrastructure moves into Terraform ([ADR-0026](adr/ADR-0026-new-google-cloud-project-created-with-terraform.md),
[RFC-0011](rfcs/RFC-0011-platform-migration.md) section 10). **Done.** Production runs in
`luminull-wally-prod` since v0.17.2 (2026-11-07), at
`https://wally-api-ttkwy6mnka-ew.a.run.app`; the release deploys to the project the `GCP_*`
variables name. `luminull-wally`, the project set up by hand before, was deleted on
2026-11-08 (RFC-0011 section 10, step 3); Google keeps a deleted project restorable for 30 days
([delete and restore](https://docs.cloud.google.com/resource-manager/docs/delete-restore-projects)).
Its setup script, `scripts/bootstrap-gcp-cicd.sh`, is removed, and sections 3 to 9 describe
the Terraform setup.

**A new Cloud Run service needs one Wally revision serving before its first full release.**
Terraform creates the service with Google's sample container, and the release's Worker
preview smoke test goes through the service URL, which serves whatever holds the traffic.
v0.17.0 therefore stopped at that test on 2026-11-07, with production unchanged. Its
candidate had passed its own smoke test, so the owner moved the new service's traffic to it
(nobody reached that service yet). A rerun of the same tag then refuses by design (Cloud Run
must not serve the release's own revision, [When a release fails](#when-a-release-fails)), so
the next tag, on a new commit, completes the switch:

```bash
gcloud run services update-traffic wally-api --region=europe-west1 \
  --project=<new project> --to-revisions=<candidate revision>=100
```

### What Terraform manages

| Root                                                         | Applied by                                                                | Manages                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`infra/terraform/bootstrap`](../infra/terraform/bootstrap/) | The owner, from their machine                                             | The project `luminull-wally-prod`, its billing link and budget, its APIs, the state bucket `luminull-wally-prod-tfstate`, and Terraform's own identity                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| [`infra/terraform/wally`](../infra/terraform/wally/)         | [Infrastructure](../.github/workflows/infrastructure.yml), after approval | In the new project: `wally-api` and `github-deployer`, the release's Workload Identity Federation, Artifact Registry, the two secrets without their values, and the Cloud Run service. On GitHub: the `production` environment, the release's variables and the ruleset on `main`. In Auth0: the tenant settings, the login prompt, `login.luminull.com`, the email and Google connections, the Wally Web, Wally ChatGPT (PKCE) and Wally account deletion applications with their grants, the two APIs, and the post-login Action, deployed from [`infra/auth0-post-login.cjs`](../infra/auth0-post-login.cjs). On Cloudflare: the two Custom Domains. On Supabase: the Third-Party Auth provider |

Change these in the code, not in a dashboard. A dashboard change to a setting the code holds
shows in the next plan and is reverted by its apply; a plan runs only when the code changes.

**The pipeline.** A pull request that touches `infra/terraform/` is formatted and validated,
without credentials. A push to `main` that touches `infra/terraform/wally/` or the Auth0
Action saves a plan at once and prints it in the run summary. The owner reads it and approves
the job "Approve the plan", whose `infrastructure-approval` environment requires them and
holds nothing else; then Apply applies exactly that plan. One approval per change
([ADR-0030](adr/ADR-0030-one-approval-for-terraform-in-a-gate-environment.md)). Plan and Apply
run in `infrastructure`, which holds Terraform's credentials, allows `main` only and has no
reviewer, so Plan runs with those credentials without a click. That is acceptable because
only code on `main` can run it. Any other change starts nothing. The repository is public, so the summary is too: the plan holds
no secret value.

### What stays outside Terraform, and how it is checked

| Part                                                                                                                                                                                                         | Why                                                                                                                                                                                                                        | Kept true by                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Organization policies, the organization's roles, the billing account                                                                                                                                         | They belong to the organization, not to Wally                                                                                                                                                                              | The bootstrap's first apply fails on a missing role; the budget emails on spend                  |
| Terraform's own access: the `infrastructure` and `infrastructure-approval` environments, the GitHub App, the `wally-terraform` Auth0 application, the Cloudflare and Supabase tokens, the state bucket's IAM | The pipeline's root does not manage them. Terraform's identity may grant only the three roles that root grants, but it can change the project's service accounts and identity pools, so read each plan before approving it | The bootstrap steps below; the environment's settings page                                       |
| Secret values (`wally-database-url`, `wally-auth0-management-client-secret`)                                                                                                                                 | Kept out of state                                                                                                                                                                                                          | `gcloud secrets versions list`; Cloud Run does not start an instance whose secret it cannot read |
| The API image, its variables and traffic; the Worker versions                                                                                                                                                | Owned by the release                                                                                                                                                                                                       | The release's smoke tests (section 13)                                                           |
| Worker settings in `wrangler.jsonc`; zone-wide Cloudflare settings                                                                                                                                           | Wrangler's configuration is Cloudflare's source of truth; the zone is shared with other sites                                                                                                                              | The release; [Zone security](#zone-security-for-luminullcom)                                     |
| Supabase: the project, the Data API switch, backups                                                                                                                                                          | Importing the project resets its database password on the next apply; the Data API switch is dashboard-only                                                                                                                | `curl https://<ref>.supabase.co/rest/v1/` answers 503 (RFC-0011 section 8)                       |
| The schema and the pg_cron job                                                                                                                                                                               | Owned by the Drizzle migrations                                                                                                                                                                                            | `migrate-cli --require-purge-job` in every release                                               |
| Auth0 users and the tenant itself                                                                                                                                                                            | Data, and tenants cannot be created through Auth0's API                                                                                                                                                                    | [AUTH0.md](AUTH0.md)                                                                             |
| The Google OAuth client in `luminull-wally-prod` (branding, audience, scopes, the client)                                                                                                                    | Made in the console: no Terraform resource for it is verified; its secret reaches Auth0 as a write-only value                                                                                                              | A Google sign-in after each change                                                               |
| Other Auth0 applications and Workers Custom Domains (`luminull.com`)                                                                                                                                         | Not Wally's                                                                                                                                                                                                                | —                                                                                                |
| GitHub secret values, the E2E fixture variables (`E2E_*`), the repository's own settings                                                                                                                     | The provider would keep secret values in state; fixtures are test data, not infrastructure                                                                                                                                 | `gh secret list`; CI fails without its fixtures                                                  |
| Vertex AI model access                                                                                                                                                                                       | Not a resource: a model answers per project and location                                                                                                                                                                   | One assistant question after the cutover (RFC-0011 section 10)                                   |

### Bootstrap (owner, once)

You need [Terraform 1.17.1](https://developer.hashicorp.com/terraform/install), and on the
organization **Project Creator**, on the billing account **Billing Account User** and **Billing
Account Costs Manager** (the budget). Sign in for Application Default Credentials:

```bash
gcloud auth application-default login
```

1. **The project, the state bucket and Terraform's identity.** The first apply keeps its state
   locally, because the bucket it stores state in does not exist yet; then the state moves into
   it. `*.tfvars` and `*_override.tf` are gitignored.

   ```bash
   cd infra/terraform/bootstrap
   printf 'org_id          = "<organization id>"\nbilling_account = "<billing account id>"\n' > terraform.tfvars
   printf 'terraform {\n  backend "local" {}\n}\n' > backend_override.tf
   terraform init
   terraform apply
   rm backend_override.tf
   terraform init -migrate-state
   rm terraform.tfstate terraform.tfstate.backup
   ```

   Keep `terraform.tfvars` for later bootstrap changes. Delete the local state files only
   after `terraform init -migrate-state` has said it copied the state.

2. **The GitHub App.** GitHub → Settings → Developer settings → GitHub Apps → **New GitHub
   App**: name `wally-terraform`, no webhook, repository permissions **Administration**,
   **Environments** and **Variables**, each read and write, and **Actions** read-only (it reads
   environments and their tag policies). Install it on
   `milad-luminull/wally` only, and generate a private key. Administration is what creates
   environments and their tag policies, and it is broad: the key is a production secret.

3. **Terraform's two environments.** `infrastructure-approval` is the gate: the owner as
   required reviewer, `main` as its only branch, and nothing stored in it. `infrastructure`
   holds the credentials: `main` only, no reviewer. Create the gate first: a workflow that
   names a missing environment creates it with no protection, and Apply would then run
   unapproved.

   ```bash
   gh api -X PUT repos/milad-luminull/wally/environments/infrastructure-approval --input - <<'JSON'
   {"prevent_self_review": false,
    "reviewers": [{"type": "User", "id": 331026245}],
    "deployment_branch_policy": {"protected_branches": false, "custom_branch_policies": true}}
   JSON
   gh api -X POST repos/milad-luminull/wally/environments/infrastructure-approval/deployment-branch-policies \
     -f name=main -f type=branch

   gh api -X PUT repos/milad-luminull/wally/environments/infrastructure --input - <<'JSON'
   {"reviewers": [],
    "deployment_branch_policy": {"protected_branches": false, "custom_branch_policies": true}}
   JSON
   gh api -X POST repos/milad-luminull/wally/environments/infrastructure/deployment-branch-policies \
     -f name=main -f type=branch

   cd infra/terraform/bootstrap
   gh variable set TERRAFORM_WIF_PROVIDER --env infrastructure --body "$(terraform output -raw terraform_wif_provider)"
   gh variable set TERRAFORM_SERVICE_ACCOUNT --env infrastructure --body "$(terraform output -raw terraform_service_account)"
   gh variable set TERRAFORM_GITHUB_APP_ID --env infrastructure --body '<app id>'
   gh variable set TERRAFORM_GITHUB_APP_INSTALLATION_ID --env infrastructure --body '<installation id>'
   gh secret set TERRAFORM_GITHUB_APP_PRIVATE_KEY --env infrastructure < <path to the .pem>
   ```

   The installation ID is the number at the end of the App's installation page URL. Delete
   the downloaded `.pem` once the secret is set.

   The other providers' credentials, each scoped to what Terraform manages:

   - **Auth0:** Applications → Create Application → `wally-terraform`, Machine to Machine,
     authorized for the Auth0 Management API with `read:`, `update:`, `create:` and `delete:`
     on `clients`, `client_grants`, `resource_servers`, `connections`, `actions`,
     `custom_domains`; `read:` and `update:` on `connections_options`, `prompts` and
     `tenant_settings`. Auth0 hides a connection's options without `connections_options`.
     No user scopes, and no `read:client_keys`, so no client secret is ever read.
   - **Cloudflare:** an account API token with Account · Workers Scripts · Edit, the
     permission the Custom Domains API lists
     ([API](https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/update/)).
   - **Supabase:** a scoped access token for the project `wally` only, with Auth Config
     read-write and Project Settings read
     ([access tokens](https://supabase.com/docs/guides/platform/personal-access-tokens)).

   ```bash
   gh variable set TERRAFORM_AUTH0_CLIENT_ID --env infrastructure --body '<client id>'
   gh secret set TERRAFORM_AUTH0_CLIENT_SECRET --env infrastructure
   gh secret set TERRAFORM_CLOUDFLARE_API_TOKEN --env infrastructure
   gh secret set TERRAFORM_SUPABASE_ACCESS_TOKEN --env infrastructure
   gh secret set TERRAFORM_GOOGLE_OAUTH_CLIENT_SECRET --env infrastructure
   ```

   Set them before a change to these providers reaches `main`; without them, its plan fails
   before it reads anything.

   **Moving from two approvals to one (once, 2026-11-07).** Until then `infrastructure`
   required the owner, and no `infrastructure-approval` existed. Right before merging the pull
   request that adds "Approve the plan", in this order:

   1. Create `infrastructure-approval`: the first two commands above. Check it shows the
      owner as reviewer and `main` as its only branch:

      ```bash
      gh api repos/milad-luminull/wally/environments/infrastructure-approval \
        --jq '{reviewers: [.protection_rules[]? | select(.type == "required_reviewers") | .reviewers[].reviewer.login], branch_policy: .deployment_branch_policy}'
      gh api repos/milad-luminull/wally/environments/infrastructure-approval/deployment-branch-policies \
        --jq '[.branch_policies[].name]'
      ```

   2. Only then remove the reviewer from `infrastructure`: the third command above (its
      `main` policy exists already, so skip the POST after it). Check with the same two
      commands for `infrastructure`: no reviewer, and `["main"]`. If the list is empty, run
      that POST.

   Removing the reviewer first would leave a window in which Plan and Apply both run
   unapproved. So would another Terraform change reaching `main` between step 2 and the merge,
   because the workflow on `main` still runs both jobs in `infrastructure`.

4. **A pipeline run that imports**, as the first one did (2026-11-07): the plan must show the
   imports with no changes, apart from what the pull request names. Anything else, stop and
   reconcile the code first.

5. **The secret values**, before the cutover: add each one as in section 7 and
   [Account deletion setup](#account-deletion-setup), with `--project=luminull-wally-prod`
   and `gcloud secrets versions add` (Terraform already created the secrets and their
   readers).

**Changing the bootstrap later:** edit `infra/terraform/bootstrap`, then plan and apply from
your machine, with the `terraform.tfvars` from step 1. The pipeline only validates it.

```bash
gcloud auth application-default login
cd infra/terraform/bootstrap
terraform init
terraform plan -out=bootstrap.tfplan
terraform apply bootstrap.tfplan
rm bootstrap.tfplan
```

Read the plan before applying it.
