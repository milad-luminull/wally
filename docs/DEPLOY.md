# Deploying Wally

A step-by-step guide to putting Wally on the internet, written for someone who has not
deployed to Google Cloud before. Every command is meant to be copy-pasted in order.

Budget about 45–90 minutes the first time. Most of it is waiting for builds.

> **The database is changing (2026-10-31).** Production runs v0.11.0, whose API stores
> everything in Cloud Firestore (database `wally`). The code this guide describes reads and
> writes only PostgreSQL ([ADR-0020](adr/ADR-0020-supabase-postgres-through-the-api-with-drizzle.md)),
> and the release that ships it applies migrations to a hosted Supabase database and hands
> Cloud Run its `DATABASE_URL` from Secret Manager. **That path is prepared but unproven: it
> has never run against a hosted database.** It needs the Supabase project, the
> `wally-database-url` secret and two IAM grants first (sections 4 and 7), and the proofs in
> [RFC-0011](rfcs/RFC-0011-platform-migration.md) section 5. Until that release, production
> is what [Firestore in production until the switch](#firestore-in-production-until-the-switch)
> describes.

---

## 1. What you are actually deploying

Wally is three separate things, and they go to three different places:

| Piece      | What it is                                                 | Where it goes                                                |
| ---------- | ---------------------------------------------------------- | ------------------------------------------------------------ |
| `apps/web` | A React app that compiles down to plain HTML/CSS/JS files  | **Firebase Hosting** (a CDN for static files)                |
| `apps/api` | A Fastify server that must stay running to answer requests | **Cloud Run** (runs a container for you)                     |
| Your data  | Notes, boards, members                                     | **Supabase PostgreSQL** (Frankfurt), reached only by the API |

Plus configuration rather than code: **Auth0** (the production sign-in for web and MCP,
see [AUTH0.md](AUTH0.md)), **Firebase Authentication** (the local and CI sign-in) and the
**database migrations** in `apps/api/drizzle/`, which ship inside the API image and run
from it at release. Firebase Auth is not a production fallback: since
the [ADR-0024](adr/ADR-0024-rename-persisted-values-without-migration.md) data reset every
account is an Auth0 signup with a random Wally id and no Firebase mapping, so switching
production back to Firebase would give every user a new, empty account. The planned move to Supabase and Cloudflare
is in [RFC-0011](rfcs/RFC-0011-platform-migration.md); this guide describes production until
then.

The flow once deployed:

```
Browser ──▶ Firebase Hosting          (serves the React app)
   │
   └──────▶ Cloud Run                  (the API; verifies the user's Auth0 access token)
                 │
                 └──▶ Supabase PostgreSQL (reads and writes the data, through the
                                           transaction pooler)
```

**Why Cloud Run and not "just Firebase"?** Firebase Hosting can only serve static files.
`apps/api` is a long-running server, so it needs somewhere that runs a container. Cloud Run
is part of the same Google Cloud project as your Firebase project — it is not a separate
service you sign up for — and it scales to zero, so it costs nothing while idle.

---

## 2. Before you start

You need these installed on your machine. Check each one:

```bash
node --version     # must be 22 or newer
docker --version   # only needed if you want to test the prod image locally
gcloud --version   # Google Cloud CLI
firebase --version # Firebase CLI
```

If `gcloud` is missing, install the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install).
If `firebase` is missing:

```bash
npm install -g firebase-tools
```

Then sign in to both. Each opens a browser window:

```bash
gcloud auth login
firebase login
```

### Names used throughout

These are already decided and deployed, and every command below has them filled in. They are
listed here so you recognise them when you see them, and so you know what to change if you
ever stand up a second environment.

| Name       | Meaning                                            | Value            |
| ---------- | -------------------------------------------------- | ---------------- |
| Project ID | The Firebase project ID (not the display name)     | `luminull-wally` |
| Region     | The Google Cloud region everything is deployed to  | `europe-west1`   |
| Repo       | Artifact Registry repository holding the API image | `wally`          |

**One region, everywhere.** Mixing regions is the single most common cause of confusing
failures. `europe-west1` (Belgium) is a sensible default for a German company and is
supported by every service used here.

---

## 3. Step 1 — Put the project on the Blaze plan

Hosting works on the free Spark plan, but **Cloud Run and Cloud Build do not**. You must
enable billing.

1. Open the [Firebase console](https://console.firebase.google.com/), select your project.
2. Bottom-left, click the plan name (**Spark**) → **Upgrade** → **Blaze**.
3. Attach a billing account (you will need a credit card).

Blaze is pay-as-you-go, not a subscription. It keeps the same free allowances on top — see
[section 14](#14-what-this-will-cost) for what Wally realistically uses. **Set a budget
alert while you are here**: Google Cloud console → **Billing → Budgets & alerts → Create
budget**. Set something small like €10/month so you find out early if something misbehaves.

---

## 4. Step 2 — Create the database

**Not done yet (2026-10-31).** No hosted Supabase project exists. Creating it, and every step
below that uses it, waits for the owner and for the proofs in
[RFC-0011](rfcs/RFC-0011-platform-migration.md) section 5. The project stays on the Free
plan; nothing is bought without the owner's approval.

1. Create a Supabase project in the Frankfurt region.
2. Copy its **transaction pooler** connection string. That is the API's `DATABASE_URL`, and
   it goes into Secret Manager in section 7, never into a file or a plain variable.
3. Switch off the **Data API**, so only the API reads and writes tables
   ([securing your API](https://supabase.com/docs/guides/api/securing-your-api)). Whether
   Auth and Realtime keep working with it off is an open proof (RFC-0011 section 5, item 3).

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
An encrypted nightly dump stored outside Supabase, and a timed restore drill, gate the switch
(RFC-0011 section 5, item 4). Neither is built yet.

---

## 5. Step 3 — Already done: Application Default Credentials on Cloud Run

The API never uses a service-account key. On Cloud Run, Google hands the container
credentials automatically through **Application Default Credentials (ADC)**, so there is no
key to create, store, or rotate — and the organization blocks service-account key creation
(`iam.disableServiceAccountKeyCreation`) anyway.

The API uses these credentials for Vertex AI (section 9b). The database is not reached
with them: Cloud Run hands the API its `DATABASE_URL` from Secret Manager (section 7).

This is already handled in the code — no edits needed before you deploy:

- **`apps/api/src/lib/firebase-app.ts`** — `getFirebaseApp()` uses `applicationDefault()`
  when running on Cloud Run, detected via `runsOnGoogleCloud()` (checks the `K_SERVICE` env
  var Cloud Run sets). Anywhere else it is initialized with the project id alone.
- **`apps/api/src/plugins/firebase.ts`** — firebase-admin is left only to verify Firebase ID
  tokens, and that needs no credential: it checks the signature against Google's public
  certificates and compares `aud`/`iss` to the project id. So the same code runs on Cloud
  Run, in compose and in CI without a key. It no longer refuses to start outside Google
  Cloud; that guard protected Firestore, which the API no longer uses.
- **`apps/api/src/env.ts`** requires `DATABASE_URL` and refuses to boot without it.
  `FIRESTORE_EMULATOR_HOST` and `FIRESTORE_DATABASE_ID` no longer exist.

To double-check it still compiles:

```bash
docker compose run --rm api pnpm turbo run typecheck test
```

---

## 6. Step 4 — Point the CLIs at your project

From the repo root:

```bash
gcloud config set project luminull-wally
firebase use --add
```

`firebase use --add` will list your projects — pick yours and give it the alias `default`.
This writes a `.firebaserc` file, which you should commit.

Now enable the Google Cloud APIs you are about to use. This takes a minute and is a
one-time thing per project:

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com
```

`firestore.googleapis.com` was enabled for the Firestore database. It stays on until
Firestore is decommissioned ([Firestore in production until the switch](#firestore-in-production-until-the-switch)).

---

## 7. Step 5 — Store the connection string and apply the migrations

**Not done yet (2026-10-31).** Like section 4, this waits for the Supabase project.

Store the transaction pooler URL from section 4 as the secret `wally-database-url`,
replicated only in the EU. `read -rs` keeps the password out of your shell history:

```bash
read -rs DATABASE_URL
printf '%s' "$DATABASE_URL" | gcloud secrets create wally-database-url \
  --data-file=- --replication-policy=user-managed --locations=europe-west1
```

Two identities read it. Grant each `roles/secretmanager.secretAccessor` on this one secret,
not the project ([access control](https://docs.cloud.google.com/secret-manager/docs/access-control)):

```bash
gcloud secrets add-iam-policy-binding wally-database-url \
  --member="serviceAccount:wally-api@luminull-wally.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding wally-database-url \
  --member="serviceAccount:github-deployer@luminull-wally.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

- **`wally-api`**, the runtime service account: Cloud Run reads the secret when an instance
  starts, and an instance whose secret cannot be read does not start
  ([Cloud Run secrets](https://docs.cloud.google.com/run/docs/configuring/services/secrets)).
- **`github-deployer`**, the release's identity: the "Apply database migrations" step reads
  the secret with `gcloud secrets versions access latest`. [`scripts/bootstrap-gcp-cicd.sh`](../scripts/bootstrap-gcp-cicd.sh)
  does not grant this yet.

### Applying the migrations

The SQL migrations live in [`apps/api/drizzle/`](../apps/api/drizzle/) and ship in the API
image at `/app/drizzle`. The server never migrates at boot. The release runs
`node dist/migrate-cli.js` from the exact image it deploys, before the candidate revision
exists (section 13). By hand, with the image you are about to deploy:

```bash
read -rs DATABASE_URL && export DATABASE_URL
docker run --rm -e DATABASE_URL -e FIREBASE_PROJECT_ID=luminull-wally \
  europe-west1-docker.pkg.dev/luminull-wally/wally/wally-api@<digest> \
  node dist/migrate-cli.js
```

`FIREBASE_PROJECT_ID` is there only because `env.ts` requires it; migrating verifies no token.

**Every migration must keep working with the revision still serving.** The schema changes
before the new revision serves, and a failed release rolls back the API, never the schema:
there are no down migrations. Add before you remove, in separate releases. Every schema
change is a new migration file ([SETUP.md](SETUP.md#docker)).

---

## 8. Step 6 — Build the API container image

Cloud Run runs containers, so we need to build one and put it somewhere Cloud Run can pull
it from. That "somewhere" is **Artifact Registry**.

Create the repository once:

```bash
gcloud artifacts repositories create wally \
  --repository-format=docker \
  --location=europe-west1 \
  --description="Wally container images"
```

### Why not `gcloud run deploy --source`?

You will see that command in most tutorials. It does not work here. It looks for a
`Dockerfile` at the root of the directory you point it at, and there is no flag to point it
at a different path. Wally's API Dockerfile lives at `apps/api/Dockerfile` but needs the
**monorepo root** as its build context (it copies `packages/shared` and the lockfile). So we
use Cloud Build with an explicit config instead.

`cloudbuild.yaml` at the repo root (already committed):

```yaml
steps:
  - name: 'gcr.io/cloud-builders/docker'
    args:
      - build
      - '-f'
      - 'apps/api/Dockerfile'
      - '-t'
      - 'europe-west1-docker.pkg.dev/luminull-wally/wally/wally-api:latest'
      - '.'
images:
  - 'europe-west1-docker.pkg.dev/luminull-wally/wally/wally-api:latest'
```

The `-f apps/api/Dockerfile ... .` is the important part: the Dockerfile comes from the
subdirectory, the build context is `.` (the repo root). Because `prod` is the last stage in
that Dockerfile, it is what gets built — no `--target` needed.

Now build. This runs on Google's machines, not yours, which also sidesteps the Apple
Silicon problem (your Mac is arm64; Cloud Run needs amd64):

```bash
gcloud builds submit --config cloudbuild.yaml .
```

First build takes 3–6 minutes. If it fails, the log URL printed at the end is the place to
look.

### If the build fails

- **`storage.objects.get` denied on the `luminull-wally_cloudbuild` bucket:** the default
  Cloud Build service account (`128432325938-compute@developer.gserviceaccount.com`) has no
  build role. Grant `roles/cloudbuild.builds.builder` to it once, wait about a minute for IAM
  to propagate, and re-run the build. Already granted on this project.

  ```bash
  gcloud projects add-iam-policy-binding luminull-wally \
    --member="serviceAccount:128432325938-compute@developer.gserviceaccount.com" \
    --role="roles/cloudbuild.builds.builder"
  ```

- **A `rootDir` TypeScript error:** `apps/api/tsconfig.build.json` sets `rootDir: "src"` and
  excludes `**/*.test.ts`, because test files import helpers from `test/`. Keep that exclude.

---

## 9. Step 7 — Deploy the API to Cloud Run

### 9a. Create a service account for the API

Cloud Run will run your container _as_ this identity — no keys involved. It needs no
database role: it reads the database's connection string from Secret Manager, which takes
the grant in section 7.

```bash
gcloud iam service-accounts create wally-api \
  --display-name="Wally API runtime"
```

The account also holds `roles/datastore.user`, granted when the API used Firestore. The
v0.11.0 revision production serves still needs it; it goes when Firestore is decommissioned
([Firestore in production until the switch](#firestore-in-production-until-the-switch)).

> IAM changes take up to 5 minutes to take effect. If your first request fails with a
> permission error, wait and retry before assuming something is broken.

### 9b. Deploy

`--set-env-vars` **replaces** the service's whole set of variables, and production needs
every one that `apiConfig` in [`scripts/resolve-release-image.mjs`](../scripts/resolve-release-image.mjs)
defines: `FIREBASE_PROJECT_ID`, `NODE_ENV`, `CORS_ORIGIN`,
`ASSISTANT_ENABLED`, `ASSISTANT_MODEL`, `ASSISTANT_VERTEX_LOCATION`, `AUTH0_ENABLED`,
`AUTH0_SIGNUP_ENABLED`, `MCP_ENABLED`, `MCP_WRITES_ENABLED` and, when set, `MCP_CLIENT_ID`.
A hand-typed list drops one easily, and a dropped `AUTH0_ENABLED` turns production sign-in
off. So build the flags with `apiConfig`, `runEnvFlag` and `runSecretsFlag`, the functions the
release uses.
The values below are what production ran on 2026-10-27 (release v0.11.0). Compare them with
`gh variable list` and `gh variable list --env production` (which overrides it) before you
deploy, and change any that differ:

```bash
export GCP_PROJECT_ID=luminull-wally WEB_ORIGIN=https://wally.luminull.com \
  ASSISTANT_ENABLED=true ASSISTANT_MODEL=vertex:gemini-3.8-flash ASSISTANT_VERTEX_LOCATION=eu \
  AUTH0_ENABLED=true AUTH0_SIGNUP_ENABLED=true MCP_ENABLED=true MCP_WRITES_ENABLED=true \
  MCP_CLIENT_ID="$(gh variable get MCP_CLIENT_ID --env production)"
RUN_ENV=$(node --input-type=module -e "
  const { apiConfig, runEnvFlag } = await import('./scripts/resolve-release-image.mjs');
  console.log(runEnvFlag(apiConfig(process.env)));")
RUN_SECRETS=$(node --input-type=module -e "
  const { apiConfig, runSecretsFlag } = await import('./scripts/resolve-release-image.mjs');
  console.log(runSecretsFlag(apiConfig(process.env)));")
echo "$RUN_ENV"; echo "$RUN_SECRETS"   # check both before deploying

gcloud run deploy wally-api \
  --image=europe-west1-docker.pkg.dev/luminull-wally/wally/wally-api:latest \
  --region=europe-west1 \
  --service-account=wally-api@luminull-wally.iam.gserviceaccount.com \
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
(default `eu`) and optionally `ASSISTANT_VERTEX_PROJECT` configure the route,
and the Cloud Run service account needs `roles/aiplatform.user`:

```bash
gcloud projects add-iam-policy-binding luminull-wally --member=serviceAccount:wally-api@luminull-wally.iam.gserviceaccount.com --role=roles/aiplatform.user
```

`GET /health` reports the configured model without calling it. The release pipeline sets
`ASSISTANT_ENABLED`, `ASSISTANT_MODEL` and `ASSISTANT_VERTEX_LOCATION` from the repository
variables of the same names (`gh variable set ASSISTANT_ENABLED --body true`), with the
API's defaults when a variable is absent; a value set by hand on the service is replaced at
the next release.

The default is Gemini 3.8 Flash on the EU multi-region endpoint (location `eu`, served
at `aiplatform.eu.rep.googleapis.com`), which keeps processing in the EU (D4). For this
project the model answers 404 in `europe-west1`, `europe-west3` and `europe-west4`
(checked 2026-10-19). Gemini 2.5 Flash, the earlier default, was retired by Google on
2026-10-20.

Two caps bound spend: `ASSISTANT_DAILY_CAP_TOKENS` (default `300000`) is each user's daily
token allowance on any key, and `ASSISTANT_MONTHLY_CAP_MICRO_USD` (default `15000000`, that
is 15 USD) is the monthly ceiling on the deployment key. The monthly cap is computed from
the price table in `apps/api/src/lib/assistant/budget/prices.ts`; check that table against
the vendor's pricing page before changing `ASSISTANT_MODEL`.

To call Vertex from a local machine, the API uses Application Default Credentials: run
`gcloud auth application-default login` with an account that has `roles/aiplatform.user`,
and the Vertex AI API (`aiplatform.googleapis.com`) must be enabled on the project. On Cloud
Run the runtime service account applies. One real turn can be run by hand, against whatever
database `DATABASE_URL` names:

```bash
pnpm --filter @wally/api assistant:smoke <uid> <boardId> "<question>"
```

### 9c. Make the service publicly reachable

Note what is _missing_ from the deploy command above: `--allow-unauthenticated`. Most
tutorials include it, and it does not work in this organization.

Cloud Run puts **two independent gates** in front of the container:

1. **Cloud Run's own IAM invoker check** — the caller needs `roles/run.invoker`.
   `--allow-unauthenticated` is just shorthand for granting that role to the special
   `allUsers` principal.
2. **Wally's own authentication** — every route goes through the auth preHandler, which
   verifies an Auth0 access token (or, locally and in CI, a Firebase ID token) and 401s
   without one.

Wally deliberately relies on gate 2. Gate 1 exists for service-to-service auth and is
redundant here — which is why making the service "public" does _not_ mean "no security".

The problem: this organization enforces **domain-restricted sharing**
(`constraints/iam.allowedPolicyMemberDomains`, limited to the Workspace customer ID). That
constraint exists precisely to stop public IAM bindings, and `allUsers` is not a domain, so
there is **no allowlist value that permits it** — the binding fails with:

```
FAILED_PRECONDITION: One or more users named in the policy do not belong to a permitted
customer, perhaps due to an organization policy.
```

Rather than weaken the org policy, disable gate 1 on this one service. This is
[Google's documented answer](https://docs.cloud.google.com/run/docs/authenticating/public)
for exactly this situation:

```bash
gcloud run services update wally-api \
  --region=europe-west1 \
  --no-invoker-iam-check
```

Same end result as `--allow-unauthenticated`, but **no IAM binding is created**, so
domain-restricted sharing is never triggered. No organization policy changes, and the scope
is this single service.

> **Do not "fix" this by overriding the org policy to Allow All.** It works, but it disables
> domain-restricted sharing for the entire project, so any external identity could be
> granted any role on anything in it. The flag above is narrower and reversible
> (`--invoker-iam-check` turns the gate back on).

The deploy prints a **Service URL**. For this project it is:

```
https://wally-api-d5xbuta4ya-ew.a.run.app
```

This native URL remains useful for diagnostics and tagged candidate checks. To print it again:

```bash
gcloud run services describe wally-api --region=europe-west1 --format='value(status.url)'
```

(Cloud Run also answers on a second, project-number-based hostname —
`https://wally-api-128432325938.europe-west1.run.app`. Both reach the same service.)

The production browser API URL is **`https://api.wally.luminull.com`**, with no trailing
slash. Its Cloud Run domain mapping must target `wally-api` in `luminull-wally` /
`europe-west1`, report `Ready=True`, and have reconciled its current generation. Cloud
Run `status.url` remains a `run.app` URL and must not be compared to the custom domain.
The canonical web origin is **`https://wally.luminull.com`**.

Sanity check it is alive:

```bash
curl https://api.wally.luminull.com/health     # expect {"status":"ok","assistant":{"enabled":…,"model":"vertex:…"}}
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
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=luminull-wally.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=luminull-wally
VITE_FIREBASE_APP_ID=...
VITE_API_BASE_URL=https://api.wally.luminull.com
VITE_AUTH_PROVIDER=auth0
VITE_AUTH0_CLIENT_ID=...
```

Production signs in with Auth0: without the last two lines the bundle falls back to the
Firebase sign-in, which production does not use. `VITE_AUTH0_CLIENT_ID` is the public SPA
client id (the `VITE_AUTH0_CLIENT_ID` repository variable), never a client secret.

The four `VITE_FIREBASE_*` values come from Firebase console → **Project settings → General → Your apps → SDK
setup and configuration**. They are the same values already in your root `.env`. These are
public identifiers, not secrets — safe to ship to the browser, because access is enforced by
Auth and by the API, not by hiding them.

`VITE_API_BASE_URL` is the canonical API URL, `https://api.wally.luminull.com`, **with no trailing slash**.

This file contains no secrets, but it is environment-specific — and it **is** gitignored:
`.gitignore` covers `.env.*`, which matches `.env.production`. (`.dockerignore` excludes it
too, so the `apps/web` Docker `prod` stage cannot see it either.)

Do not commit it. CI does not use it at all: the release workflow supplies the same seven
values from GitHub repository _variables_ — they are public identifiers baked into a public
bundle, so they are variables rather than secrets — and asserts afterwards that the built
bundle really does contain the production API URL and not `localhost:4000`.

### 10b. The Hosting block in `firebase.json`

Already present in [`firebase.json`](../firebase.json), which holds nothing else now:

```json
  "hosting": {
    "public": "apps/web/dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [{ "source": "**", "destination": "/index.html" }]
  }
```

That single rewrite is what makes React Router work. Without it, loading
`https://luminull-wally.web.app/board/123` directly returns 404, because no such file exists
— the rewrite hands every unmatched path to `index.html` and lets the router sort it out.

### 10c. Build and deploy

```bash
pnpm --filter @wally/web build
firebase deploy --only hosting
```

The output ends with a **Hosting URL**: `https://luminull-wally.web.app`.

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

## 11. Step 9 — Let Firebase Auth trust your new domain

Sign-in fails with `auth/unauthorized-domain` if the serving domain is not on the list.

Already correct for this project — `localhost`, `luminull-wally.firebaseapp.com` and
`luminull-wally.web.app` are authorized, and both Email/Password and Google sign-in are
enabled. Add any custom domain you later attach: Firebase console → **Authentication →
Settings → Authorized domains**.

To check the current state without clicking through the console:

```bash
curl -s "https://identitytoolkit.googleapis.com/admin/v2/projects/luminull-wally/config" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "X-Goog-User-Project: luminull-wally" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['authorizedDomains'])"
```

### Check CORS matches

Production requires `CORS_ORIGIN=https://wally.luminull.com`. It must match the browser
origin **exactly**, including scheme and no trailing slash. To reconcile an older deployment:

```bash
gcloud run services update wally-api \
  --region=europe-west1 \
  --update-env-vars="CORS_ORIGIN=https://wally.luminull.com"
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

The run pauses on the `production` GitHub Environment until someone approves it. It
authenticates with Workload Identity Federation, so there is no key to manage — which is
just as well, since the organization blocks service-account key creation entirely.

[The release guard](../scripts/check-api-domain.mjs) verifies that the `api.wally.luminull.com` mapping targets
`wally-api` and is ready, HTTPS health, unauthenticated 401, and a successful CORS preflight allowing authorization and
content-type from the canonical web origin. It runs before deployment and again after
promotion; a failure after traffic shifts follows the existing rollback path. Run its
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
  its variables are exactly `apiConfig`'s and `DATABASE_URL` comes from `wally-database-url`
  (`node scripts/resolve-release-image.mjs verify`).
- **Checks the deployed bundle** actually contains the production API URL and not
  `localhost:4000`.

### Rolling back

Automatic, if a smoke test fails after traffic moved. By hand:

```bash
# API — pick the previous revision
gcloud run services update-traffic wally-api --region=europe-west1 \
  --to-revisions=<previous-revision>=100
```

For Hosting there is **no `firebase hosting:rollback` command** — that is worth knowing
before you go looking for it under pressure. Either use the Firebase console
(**Hosting → Release history → Rollback**), or re-release a previous version directly:

```bash
TOKEN=$(gcloud auth print-access-token)
# newest first; [1] is the release before the current one
PREV=$(curl -fsS -H "Authorization: Bearer $TOKEN" \
  "https://firebasehosting.googleapis.com/v1beta1/sites/luminull-wally/releases?pageSize=2" \
  | jq -r '.releases[1].version.name')
curl -fsS -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Length: 0" \
  "https://firebasehosting.googleapis.com/v1beta1/sites/luminull-wally/releases?versionName=$PREV"
```

**A rollback reverts the API, never the schema.** There are no down migrations, so the
schema a release applied stays when its revision is rolled back. That is why every migration
must keep working with the revision before it (section 7).

**None of the smoke checks reads the database.** `/health` and the unauthenticated 401 never
query it, so a candidate that cannot reach Supabase passes them. A missing secret or grant
does fail: the revision does not start. Connectivity from Cloud Run is a proof still to run
(RFC-0011 section 5, item 1).

**The first PostgreSQL release is different.** Rolling it back sends traffic to v0.11.0,
which reads Firestore, so anything written to PostgreSQL in between is not visible there.
RFC-0011 section 6 requires the rollback window to be agreed before that release.

### The manual path (break-glass)

Still correct, and still what to reach for if Actions is down:

**Backend changed:**

```bash
gcloud builds submit --config cloudbuild.yaml .
gcloud run deploy wally-api \
  --image=europe-west1-docker.pkg.dev/luminull-wally/wally/wally-api:latest \
  --region=europe-west1
```

**Frontend changed:**

```bash
pnpm --filter @wally/web build
firebase deploy --only hosting
```

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

For an app this size, realistically **near zero**, but Blaze means "pay for what you use"
rather than "free with a hard cap", so it is worth knowing the shape.

The database is a Supabase project on the Free plan. Its budget is in
[RFC-0011](rfcs/RFC-0011-platform-migration.md) section 2, and the Free plan's catches (no
managed backups, a project that can pause) in its section 7. Nothing beyond Free is bought
without the owner's approval. Cloud Run scales to zero — you are billed per request and per second of execution, and
an idle service costs nothing. Firebase Hosting gives 10 GB of storage and 360 MB/day of
transfer free.

The thing that would actually cost money is a runaway loop on Cloud Run or the assistant. That is
exactly what the budget alert in [section 3](#3-step-1--put-the-project-on-the-blaze-plan)
is for.

---

## 15. Troubleshooting

**The new revision never starts, and its logs mention the secret**
Cloud Run could not read `wally-database-url`: the `wally-api` account lacks
`roles/secretmanager.secretAccessor` on it, or you are within the IAM propagation window.
Re-run the grant from section 7 and wait.

**"Apply database migrations" fails in the release**
The deploy identity cannot read the secret (section 7), or the runner cannot reach the
host. GitHub-hosted runners reach only IPv4, so the secret must hold a pooler URL, not the
direct connection (section 4).

**The API refuses to boot with `Invalid environment configuration: DATABASE_URL`**
`DATABASE_URL` is missing or not a URL. On Cloud Run it comes only from `--set-secrets`;
check the revision with
`gcloud run services describe wally-api --region=europe-west1 --format="value(spec.template.spec.containers[0].env)"`.

**White screen, console shows `auth/invalid-api-key`**
The `VITE_*` variables were not present when you built. Confirm `apps/web/.env.production`
exists, then rebuild — the values are compiled in, so editing the file without rebuilding
changes nothing.

**`auth/unauthorized-domain` when signing in**
Section 11 — add the domain to Firebase Auth's authorized domains.

**CORS errors in the browser console**
`CORS_ORIGIN` on Cloud Run does not exactly match the origin the browser is using. Compare
them character by character, including `https://` and the absence of a trailing slash.

**Reading the actual logs** — this is the thing to reach for before guessing:

```bash
gcloud run services logs read wally-api --region=europe-west1 --limit=50
```

**Cloud Build fails on `COPY packages/shared`**
You ran the build from a subdirectory. It must run from the repo root, because the build
context is the whole monorepo: `gcloud builds submit --config cloudbuild.yaml .`

**A generic Google "Error 404 (Not Found)" HTML page instead of your app's response**
This is never your app's 404 — your app answers in JSON. It means the request was stopped
before it reached the container. Two different causes, and you tell them apart by _how many_
paths are affected:

- **Every path 404s** — the caller has no `roles/run.invoker`, so Cloud Run's front end
  refuses everything. (It returns 404 rather than 403 so it does not leak whether a private
  service exists.) Fix: section 9c, `--no-invoker-iam-check`. Check the current state with
  `gcloud run services describe wally-api --region=europe-west1 --format="value(metadata.annotations.'run.googleapis.com/invoker-iam-disabled')"`
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
- **A separate staging project.** The usual approach is a second Firebase project with the
  same setup, selected via `firebase use`.
- **Seed data in production.** `make seed` writes fixture users that do not exist in any real
  sign-in provider into whatever `DATABASE_URL` names. The E2E and local MCP fixture seeds
  refuse a non-local database; the demo seed does not. Never run it with the production
  secret.
- **Backups.** Not built. The Free plan has none, and a backup routine with a restore drill
  gates the switch (section 4).

---

## 17. Continuous integration

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on every pull request and on
pushes to `main`, in six jobs:

| Job                          | What it proves                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Lint & format**            | `prettier --check` and `eslint` across the workspace.                                                                                                              |
| **Typecheck & build**        | `turbo run typecheck build`. Both, because they use different tsconfigs — section 8 records a real case where typecheck was clean and the production build failed. |
| **Unit & integration tests** | The Vitest suites against a `postgres` service on the same `supabase/postgres` image as compose; each API test file clones its own database (ADR-0025).            |
| **E2E (full stack)**         | Playwright against a real `docker compose` stack.                                                                                                                  |
| **Detect docs-only changes** | Whether a pull request changes anything besides `*.md` files and `docs/`. Only the E2E job reads it.                                                               |
| **E2E gate**                 | The required check: passes when E2E passed or was skipped for a docs-only change, fails otherwise. See below.                                                      |

### Two things about the E2E job that are easy to get wrong

**It runs against the stack's own database, not production.** Every spec writes real data,
and `share.spec.ts` creates an invite on each run. Against production those records would
accumulate in the live database forever. The compose stack runs its own PostgreSQL, created
fresh on the runner, while sign-in still goes through real Firebase Auth (or real Auth0, on
the opt-in path), so the coverage is genuine and the data is disposable. Production only ever gets read-only smoke checks.

**A green E2E job is not automatically a meaningful one.** Every spec opens with
`test.skip(!hasE2eCredentials, …)`, so a missing secret produces a passing run that tested
nothing. The workflow parses Playwright's JSON report and fails if any test reported
`skipped`, if fewer than `MIN_EXECUTED` (22, every listed test) executed, or if fewer than
two projects produced results.

### Documentation-only pull requests

When every file a pull request changes is a `*.md` file or sits under `docs/`, the E2E job is
skipped and `E2E gate` passes, saying why. Everything else still runs, so Markdown is still
format-checked. Pushes to `main` always run E2E, because the release workflow requires `main`'s
full CI run before it deploys. The reasoning is in
[ADR-0012](adr/ADR-0012-skip-e2e-on-documentation-only-pull-requests.md).

### Pull requests from forks

The repository is public, so anyone can open a pull request. GitHub withholds secrets from
fork PRs, which is the desired behaviour — but it means the E2E job cannot run. It is
therefore skipped there, and a separate **`E2E gate`** job fails with an explanation.

Make `E2E gate` the required status check, **not** `E2E (full stack)`: a skipped required
check counts as passing, which would let exactly the least-trusted pull requests merge with
no end-to-end coverage at all.

### Configuration

Set once, by [`scripts/bootstrap-gcp-cicd.sh`](../scripts/bootstrap-gcp-cicd.sh) and by hand.

**Repository variables** — public identifiers, not secrets. They are compiled into a bundle
that anyone can download, so hiding them would buy nothing:

`GCP_PROJECT_ID`, `GCP_REGION`, `GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA`, `API_BASE_URL`,
`WEB_ORIGIN`, `FIREBASE_PROJECT_ID`, `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`,
`VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`.

**Auth0/MCP variables:** production runs with `AUTH0_ENABLED`, `AUTH0_SIGNUP_ENABLED`,
`MCP_ENABLED` and `MCP_WRITES_ENABLED` set to `true`, `VITE_AUTH_PROVIDER=auth0`, and
`VITE_AUTH0_CLIENT_ID` and `MCP_CLIENT_ID` set to the public SPA and MCP client IDs.
Unset, the switches default to `false` and the provider to `firebase`. Both client IDs are
public identifiers, never client secrets. The release validates combinations before any
deployment and reads the exact API flags and client ID back after deployment. Missing
MCP client IDs are omitted from Cloud Run rather than deployed as empty strings.

The issuer `https://login.luminull.com/` and REST audience
`https://api.wally.luminull.com` are fixed in the API (`apps/api/src/lib/auth/constants.ts`), not set by the release.
The web bundle receives the provider and SPA client ID at build time; changing repository
variables does not change a deployed bundle. The Firebase build variables are still
required: the release checks them, and the bundle keeps the Firebase sign-in that local
development and CI use. These switches do not provision Auth0 tenant
settings or grant connector access; see [AUTH0.md](AUTH0.md).

**Repository secrets:** `E2E_USER_EMAIL` and `E2E_USER_PASSWORD` are the Firebase test
account CI signs in with by default. The opt-in Auth0 path uses `E2E_AUTH0_USER_PASSWORD` with the account email
and subject stored as repository variables. Keep a separate password under that same
secret name in Dependabot secrets, alongside its separate account variables. See the
[E2E setup](../apps/web/e2e/README.md) for provider selection and isolated HTTPS routing.

> There is deliberately **no service-account key anywhere.** The organization enforces
> `iam.disableServiceAccountKeyCreation`, and the API never uses one: ADC on Cloud Run, and
> nothing elsewhere, since verifying a token needs no credential (section 5). The database
> password is the one secret, in Secret Manager (section 7).

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
retention targets, not exact erasure times.

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

## Firestore in production until the switch

Production runs v0.11.0 on Cloud Firestore until the release that ships the PostgreSQL API.
What that means, and what stays until Firestore is decommissioned (RFC-0011 section 6,
workstream 6):

- **The database is `wally`, in `europe-west3` (Frankfurt).** The project also has a
  `(default)` database in `nam5` (United States), auto-created and empty. The v0.11.0
  revision sets `FIRESTORE_DATABASE_ID=wally`; without it, firebase-admin writes to
  `(default)`. Keep that variable on any v0.11.0 revision you redeploy or roll back to.
- **Rules, composite indexes and the six TTL policies** were deployed by earlier releases
  and stay on the `wally` database. The files that declared them (`firestore.rules`,
  `firestore.indexes.json`) are deleted from the repository, and `firebase.json` now holds
  Hosting only, so the release no longer touches them. Nothing should change them before
  decommissioning.
- **IAM:** the `wally-api` account keeps `roles/datastore.user` (section 9a), and the deploy
  identity keeps `roles/firebaserules.admin` and `roles/datastore.indexAdmin`, which
  `scripts/bootstrap-gcp-cicd.sh` grants. Remove them at decommissioning.
- **Data:** none is carried over. PostgreSQL starts empty, and every user starts with a new
  account there ([RFC-0011](rfcs/RFC-0011-platform-migration.md) section 1).

## Account-cleanup worker (retired)

Removed in PR #76 with self-service account export and deletion; its cloud resources and its
`accountDeletionJobs` and `accountDenials` collections were deleted on 2026-10-27.
