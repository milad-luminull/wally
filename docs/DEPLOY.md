# Deploying Wally

A step-by-step guide to putting Wally on the internet, written for someone who has not
deployed to Google Cloud before. Every command is meant to be copy-pasted in order.

Budget about 45–90 minutes the first time. Most of it is waiting for builds.

---

## 1. What you are actually deploying

Wally is three separate things, and they go to three different places:

| Piece      | What it is                                                 | Where it goes                                                  |
| ---------- | ---------------------------------------------------------- | -------------------------------------------------------------- |
| `apps/web` | A React app that compiles down to plain HTML/CSS/JS files  | **Firebase Hosting** (a CDN for static files)                  |
| `apps/api` | A Fastify server that must stay running to answer requests | **Cloud Run** (runs a container for you)                       |
| Your data  | Notes, boards, members                                     | **Cloud Firestore** (already the database, nothing to install) |

Plus two things that are configuration rather than code: **Firebase Authentication**
(already used for sign-in) and your **Firestore security rules and indexes**.

The flow once deployed:

```
Browser ──▶ Firebase Hosting          (serves the React app)
   │
   └──────▶ Cloud Run                  (the API; verifies the user's Firebase token)
                 │
                 └──▶ Cloud Firestore  (reads and writes the data)
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

Firestore and Hosting both work on the free Spark plan, but **Cloud Run and Cloud Build do
not**. You must enable billing.

1. Open the [Firebase console](https://console.firebase.google.com/), select your project.
2. Bottom-left, click the plan name (**Spark**) → **Upgrade** → **Blaze**.
3. Attach a billing account (you will need a credit card).

Blaze is pay-as-you-go, not a subscription. It keeps the same free allowances on top — see
[section 14](#14-what-this-will-cost) for what Wally realistically uses. **Set a budget
alert while you are here**: Google Cloud console → **Billing → Budgets & alerts → Create
budget**. Set something small like €10/month so you find out early if something misbehaves.

---

## 4. Step 2 — Create the Firestore database

Your local development uses the Firestore _emulator_, which is a fake. The real database
does not exist yet until you create it.

1. Firebase console → **Build → Firestore Database** → **Create database**.
2. Choose **Production mode** (starts locked down — correct, since only our API touches it).
3. Choose a location in the EU.

> **A database's location is permanent.** It cannot be changed after creation; the only fix
> is a different database. Choose deliberately.

### Which database this project actually uses

There are two, and this matters more than it looks:

| Database    | Location                   | Used                           |
| ----------- | -------------------------- | ------------------------------ |
| `wally`     | `europe-west3` (Frankfurt) | **yes — this is the real one** |
| `(default)` | `nam5` (United States)     | no — auto-created, left empty  |

Google creates a `(default)` database in the US on its own if something asks for one before
you have made your choice. The Admin SDK's `getFirestore(app)` resolves to `(default)`
**unless you name a database**, so the natural-looking code silently writes to the US.

That is why [`apps/api/src/lib/db/client.ts`](../apps/api/src/lib/db/client.ts) reads
`FIRESTORE_DATABASE_ID` and Cloud Run sets it to `wally` (section 9b). Locally it is left
unset, because the emulator serves `(default)` and nothing leaves your machine.

If you ever see production data appear nowhere in the Frankfurt database, check that env var
first — writes are going to the US one.

---

## 5. Step 3 — Already done: Application Default Credentials on Cloud Run

The API used to refuse to start unless you gave it a service-account key file
(`FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`). On Cloud Run you do not want that:
Google hands the container credentials automatically through something called **Application
Default Credentials (ADC)**, so there is no key to create, store, or rotate.

This mattered extra here: [`README.md`](../README.md) records that the organization blocks
service-account key creation (`iam.disableServiceAccountKeyCreation`), so a key is not always
available to create.

This is already handled in the code — no edits needed before you deploy:

- **`apps/api/src/lib/firebase-app.ts`** — `getFirebaseApp()` uses the service-account key
  when one is configured (local dev), and falls back to `applicationDefault()` when running
  on Cloud Run, detected via `runsOnGoogleCloud()` (checks the `K_SERVICE` env var Cloud Run
  sets).
- **`apps/api/src/plugins/firebase.ts`** — the startup guard passes when either a key is
  configured or the process is running on Google Cloud. Cloud Run starts fine with no key,
  while local dev still fails fast if the key is missing.

There is now a third arm, added so CI can run the full stack without a key at all:

- **`apps/api/src/plugins/firebase.ts`** also accepts a credential-less start when
  `FIRESTORE_EMULATOR_HOST` is set. Verifying an ID token needs no credential — firebase-admin
  checks the signature against Google's public certificates and compares `aud`/`iss` to the
  project id. A credential is required for _Firestore_, so the emulator case is genuinely safe.
- **`apps/api/src/env.ts`** makes `NODE_ENV=production` together with `FIRESTORE_EMULATOR_HOST`
  a fatal startup error, so that relaxation can never apply to production. This also turns the
  "emulator host leaked into production" failure in section 15 from a per-request 500 into a
  refusal to boot.

If you ever touch these files, keep all three arms intact. To double-check it still compiles:

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
  firestore.googleapis.com
```

---

## 7. Step 5 — Deploy the Firestore rules and indexes

Two files in the repo root control your production database. Neither is enforced by the
local emulator, so **this is the step people forget** and then get mystery errors in
production.

- [`firestore.rules`](../firestore.rules) — denies all direct client access. This is
  correct: only the API (via the Admin SDK, which bypasses rules) should touch data.
- [`firestore.indexes.json`](../firestore.indexes.json) — the composite indexes that the
  members and notes queries need. The emulator invents indexes on the fly; real Firestore
  does not, and a missing one surfaces as a `FAILED_PRECONDITION` error at runtime.

```bash
firebase deploy --only firestore
```

That deploys both rules and indexes. (`--only firestore:rules` and
`--only firestore:indexes` work individually if you ever need them.)

[`firebase.json`](../firebase.json) pins this to the right database with
`"firestore": { "database": "wally", ... }`. Without that key the CLI targets `(default)` —
the US one — and you get indexes built on a database nothing reads. Confirm where they
landed:

```bash
gcloud firestore indexes composite list --database=wally --format="table(name.basename(),state)"
```

Index building is asynchronous — the command returns before the indexes are ready. Watch
the progress in Firebase console → **Firestore Database → Indexes**. Wait until they all
say **Enabled** before testing sharing or invites.

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

### Two things that bit us the first time

- **The Cloud Build service account had no permissions.** On newer Google Cloud projects,
  the default Cloud Build service account (`128432325938-compute@developer.gserviceaccount.com`
  — that number is the project number) no longer gets Editor automatically. If
  `gcloud builds submit` fails immediately with `storage.objects.get` denied on the
  `luminull-wally_cloudbuild` bucket, grant it the build role once:

  ```bash
  gcloud projects add-iam-policy-binding luminull-wally \
    --member="serviceAccount:128432325938-compute@developer.gserviceaccount.com" \
    --role="roles/cloudbuild.builds.builder"
  ```

  Wait about a minute for IAM to propagate, then re-run the build. This is already done for
  this project — it is recorded here because the symptom looks like a broken build config
  rather than a permissions problem.

- **The production build failed on a `rootDir` TypeScript error.** `apps/api/tsconfig.build.json`
  only lists `"include": ["src"]`, but `src/**/*.test.ts` files import helpers from
  `test/helpers.ts`, which lives outside `src` — that trips `rootDir` under `tsc -p
tsconfig.build.json` even though `pnpm typecheck` (a different tsconfig, no `rootDir`)
  was clean. Fixed by excluding test files from the production build, since they were never
  meant to ship anyway:

  ```json
  {
    "extends": "./tsconfig.json",
    "compilerOptions": {
      "rootDir": "src"
    },
    "include": ["src"],
    "exclude": ["**/*.test.ts"]
  }
  ```

  This is already fixed in the repo — noted here in case it resurfaces after future changes
  to `src/`.

---

## 9. Step 7 — Deploy the API to Cloud Run

### 9a. Create a service account for the API

Cloud Run will run your container _as_ this identity, and this is what gives it Firestore
access — no keys involved.

```bash
gcloud iam service-accounts create wally-api \
  --display-name="Wally API runtime"

gcloud projects add-iam-policy-binding luminull-wally \
  --member="serviceAccount:wally-api@luminull-wally.iam.gserviceaccount.com" \
  --role="roles/datastore.user"
```

`roles/datastore.user` is read/write access to Firestore data and nothing else. (Firestore
is the successor to a product called Datastore, which is why the role has that name.)

> IAM changes take up to 5 minutes to take effect. If your first request fails with a
> permission error, wait and retry before assuming something is broken.

### 9b. Deploy

```bash
gcloud run deploy wally-api \
  --image=europe-west1-docker.pkg.dev/luminull-wally/wally/wally-api:latest \
  --region=europe-west1 \
  --service-account=wally-api@luminull-wally.iam.gserviceaccount.com \
  --set-env-vars="FIREBASE_PROJECT_ID=luminull-wally,NODE_ENV=production,CORS_ORIGIN=https://wally.luminull.com,FIRESTORE_DATABASE_ID=wally"
```

Three things worth understanding:

- **`FIRESTORE_DATABASE_ID=wally` is not optional.** Drop it and the API silently writes to
  the `(default)` database, which lives in the United States. See section 4.
- **Do not set `PORT`.** Cloud Run injects it (8080), and the server already reads
  `env.PORT` and binds `0.0.0.0`. Setting it yourself is rejected.
- **Do not set `FIRESTORE_EMULATOR_HOST`.** If that leaks into production the API will
  quietly try to reach a non-existent emulator instead of your real database. Note it is
  absent from the command above on purpose.

`--set-env-vars` **replaces** the whole set, so every redeploy must list all four. Use
`--update-env-vars` to change one without touching the others.

The assistant is off unless `ASSISTANT_ENABLED=true` is set. When it is on, `ASSISTANT_MODEL`
(`provider:model`, default `vertex:gemini-2.5-flash`), `ASSISTANT_VERTEX_LOCATION`
(default `europe-west1`) and optionally `ASSISTANT_VERTEX_PROJECT` configure the route,
and the Cloud Run service account needs `roles/aiplatform.user`:

```bash
gcloud projects add-iam-policy-binding luminull-wally --member=serviceAccount:wally-api@luminull-wally.iam.gserviceaccount.com --role=roles/aiplatform.user
```

`GET /health` reports the configured model without calling it. The release pipeline sets
`ASSISTANT_ENABLED`, `ASSISTANT_MODEL` and `ASSISTANT_VERTEX_LOCATION` from the repository
variables of the same names (`gh variable set ASSISTANT_ENABLED --body true`), with the
API's defaults when a variable is absent; a value set by hand on the service is replaced at
the next release.

The default is Gemini 2.5 Flash because the EU regions serve it. As of 2026-10-16,
Gemini 3.8 Flash is served only on the `global` endpoint for this project: it answers 404
in `europe-west1` and `europe-west4`. Using it means setting
`ASSISTANT_MODEL=vertex:gemini-3.8-flash` together with `ASSISTANT_VERTEX_LOCATION=global`,
which moves processing outside the EU and needs the owner's decision under D4.

Two caps bound spend: `ASSISTANT_DAILY_CAP_TOKENS` (default `300000`) is each user's daily
token allowance on any key, and `ASSISTANT_MONTHLY_CAP_MICRO_USD` (default `15000000`, that
is 15 USD) is the monthly ceiling on the deployment key. The monthly cap is computed from
the price table in `apps/api/src/lib/assistant/budget/prices.ts`; check that table against
the vendor's pricing page before changing `ASSISTANT_MODEL`.

To call Vertex from a local machine, the API uses the Firebase service account
(`FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY`) when both are set. That account then
needs `roles/aiplatform.user`, and the Vertex AI API (`aiplatform.googleapis.com`) must be
enabled on the project. On Cloud Run the variables are absent and the runtime service
account applies. One real turn can be run by hand, against whatever Firestore the
environment points at:

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
   verifies a Firebase ID token and 401s without one.

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
> This is invisible locally (the emulator stack and `docker compose` never go through GFE),
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
```

The first four come from Firebase console → **Project settings → General → Your apps → SDK
setup and configuration**. They are the same values already in your root `.env`. These are
public identifiers, not secrets — safe to ship to the browser, because access is enforced by
Auth and by the API, not by hiding them.

`VITE_API_BASE_URL` is the canonical API URL, `https://api.wally.luminull.com`, **with no trailing slash**.

This file contains no secrets, but it is environment-specific — and it **is** gitignored:
`.gitignore` covers `.env.*`, which matches `.env.production`. (`.dockerignore` excludes it
too, so the `apps/web` Docker `prod` stage cannot see it either.)

Do not commit it. CI does not use it at all: the release workflow supplies the same five
values from GitHub repository _variables_ — they are public identifiers baked into a public
bundle, so they are variables rather than secrets — and asserts afterwards that the built
bundle really does contain the production API URL and not `localhost:4000`.

### 10b. The Hosting block in `firebase.json`

Already present in [`firebase.json`](../firebase.json), alongside `"firestore"` and
`"emulators"`:

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
5. Firebase console → **Firestore Database → Data**: you can see a `whiteboards` document
   whose ID is your Firebase user ID, plus your note under `notes`.
6. Drag a note between horizon zones, then open it and confirm the history shows the move.
7. Add a subtask, tick it, confirm the counter on the card updates.
8. Open **Teilen**, invite an email address, confirm the member appears as `PENDING`.

If step 8 errors, it is almost certainly indexes still building — check
**Firestore → Indexes**.

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

Before releasing the domain migration, set repository variables `API_BASE_URL` to
`https://api.wally.luminull.com` and `WEB_ORIGIN` to `https://wally.luminull.com`.
Confirm DNS and the managed certificate are ready, the API mapping targets `wally-api`,
and the currently serving revision already allows the canonical web origin. The preflight
checks run before deployment and intentionally refuse an incomplete migration. The deploy
identity needs `run.domainmappings.get` in the configured project. No configuration or
DNS changes are made by the check.

[The release guard](../scripts/check-api-domain.mjs) verifies mapping readiness, HTTPS
health, unauthenticated 401, and a successful CORS preflight allowing authorization and
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
- **Asserts the environment back** after deploying. `--set-env-vars` replaces the whole set,
  so the workflow re-reads the service and fails the release if `FIRESTORE_DATABASE_ID` is
  not `wally` (see section 4 for why that is the worst thing that can silently go wrong).
- **Waits for composite indexes to reach READY** instead of returning while they build.
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

Firestore rules and indexes have no inverse operation. Reverting means re-deploying the
previous `firestore.rules` from git, which is why rules changes are worth releasing on their
own.

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

**Rules or indexes changed:**

```bash
firebase deploy --only firestore
```

Cloud Run keeps every revision. If a deploy breaks production, roll back in the Cloud Run
console: select the service → **Revisions** → pick the previous one → **Manage traffic** →
send 100% to it. That is faster than rebuilding.

---

## 14. What this will cost

For an app this size, realistically **near zero**, but Blaze means "pay for what you use"
rather than "free with a hard cap", so it is worth knowing the shape.

Firestore's permanently-free daily allowance is 50,000 document reads, 20,000 writes,
20,000 deletes, and 1 GiB stored. Wally reads roughly one document per note shown, and the
frontend refetches on window focus, so a handful of people using it daily lands nowhere near
that. Cloud Run scales to zero — you are billed per request and per second of execution, and
an idle service costs nothing. Firebase Hosting gives 10 GB of storage and 360 MB/day of
transfer free.

The thing that would actually cost money is a runaway loop hammering Firestore. That is
exactly what the budget alert in [section 3](#3-step-1--put-the-project-on-the-blaze-plan)
is for.

---

## 15. Troubleshooting

**`PERMISSION_DENIED` / `Missing or insufficient permissions` from the API**
The runtime service account lacks `roles/datastore.user`, or you are within the 5-minute IAM
propagation window. Re-run the `add-iam-policy-binding` command from step 9a and wait.

**`FAILED_PRECONDITION: The query requires an index`**
An index from `firestore.indexes.json` is missing or still building. Run
`firebase deploy --only firestore:indexes` and watch Firestore → Indexes. The error message
also contains a direct link that creates the exact index needed. If the indexes look present
in the console but the error persists, check you are looking at the `wally` database and not
`(default)` — the console defaults to whichever it feels like.

**Writes succeed but the data is nowhere to be found in the Firestore console**
You are almost certainly looking at the wrong database. Production writes to `wally`
(Frankfurt); `(default)` (US) should stay empty. Check the running config with
`gcloud run services describe wally-api --region=europe-west1 --format="value(spec.template.spec.containers[0].env)"`
— `FIRESTORE_DATABASE_ID=wally` must be there. A redeploy that used `--set-env-vars` without
listing it would have dropped it.

**White screen, console shows `auth/invalid-api-key`**
The `VITE_*` variables were not present when you built. Confirm `apps/web/.env.production`
exists, then rebuild — the values are compiled in, so editing the file without rebuilding
changes nothing.

**`auth/unauthorized-domain` when signing in**
Section 11 — add the domain to Firebase Auth's authorized domains.

**CORS errors in the browser console**
`CORS_ORIGIN` on Cloud Run does not exactly match the origin the browser is using. Compare
them character by character, including `https://` and the absence of a trailing slash.

**API returns 500s and the logs mention connecting to `firestore:8080` or ECONNREFUSED**
`FIRESTORE_EMULATOR_HOST` leaked into the Cloud Run environment. Remove it:
`gcloud run services update wally-api --region=europe-west1 --remove-env-vars=FIRESTORE_EMULATOR_HOST`

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

- **A custom domain.** Firebase console → Hosting → Add custom domain. Remember to update
  `CORS_ORIGIN` and Auth authorized domains afterwards.
- ~~**Automated deploys from GitHub.**~~ Done — see section 13 and
  [`.github/workflows/`](../.github/workflows/). Everything above remains valid as the
  manual break-glass path.
- **A separate staging project.** The usual approach is a second Firebase project with the
  same setup, selected via `firebase use`.
- **Seed data in production.** `make seed` targets the emulator and writes fixture users
  that do not exist in real Firebase Auth. Do not point it at production.
- **Backups.** Firestore supports scheduled exports; worth setting up before the data
  matters to anyone.

---

## 17. Continuous integration

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on every pull request and on
pushes to `main`, in four parallel jobs:

| Job                          | What it proves                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Lint & format**            | `prettier --check` and `eslint` across the workspace.                                                                                                              |
| **Typecheck & build**        | `turbo run typecheck build`. Both, because they use different tsconfigs — section 8 records a real case where typecheck was clean and the production build failed. |
| **Unit & integration tests** | The Vitest suites, with a Firestore emulator started by `firebase emulators:exec` so CI reads this repo's own `firebase.json`.                                     |
| **E2E (full stack)**         | Playwright against a real `docker compose` stack.                                                                                                                  |
| **Detect docs-only changes** | Whether a pull request changes anything besides `*.md` files and `docs/`. Only the E2E job reads it.                                                               |

### Two things about the E2E job that are easy to get wrong

**It runs against the emulator, not production.** Every spec writes real data, and
`share.spec.ts` creates an invite on each run. Against production those records would
accumulate in the live `wally` database forever. Compose routes Firestore to the emulator
while sign-in still goes through real Firebase Auth, so the coverage is genuine and the data
is disposable. Production only ever gets read-only smoke checks.

**A green E2E job is not automatically a meaningful one.** Every spec opens with
`test.skip(!hasE2eCredentials, …)`, so a missing secret produces a passing run that tested
nothing. The workflow parses Playwright's JSON report and fails if any test reported
`skipped`, if fewer than six executed, or if fewer than two projects produced results.

### Documentation-only pull requests

When every file a pull request changes is a `*.md` file or sits under `docs/`, the E2E job is
skipped and `E2E gate` passes, saying why. Everything else still runs, so Markdown is still
format-checked. Pushes to `main` always run E2E, because the release workflow requires `main`'s
full CI run before it deploys. The reasoning is in
[ADR-0012](adr/0012-skip-e2e-on-documentation-only-pull-requests.md).

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

**Opt-in Auth0/MCP rollout variables:** `AUTH0_ENABLED`, `MCP_ENABLED` and
`MCP_WRITES_ENABLED` default to `false`; `VITE_AUTH_PROVIDER` defaults to `firebase`.
For Auth0 browser login, explicitly set `AUTH0_ENABLED=true`, `VITE_AUTH_PROVIDER=auth0`
and `VITE_AUTH0_CLIENT_ID` to the public SPA client ID. For MCP, also set
`MCP_ENABLED=true`, `ASSISTANT_ENABLED=true` and `MCP_CLIENT_ID` to the approved MCP client ID. Set
`MCP_WRITES_ENABLED=true` only after the write rollout gates pass. Both client IDs are
public identifiers, never client secrets. The release validates combinations before any
deployment and reads the exact API flags and client ID back after deployment. Missing
MCP client IDs are omitted from Cloud Run rather than deployed as empty strings.

The issuer `https://login.luminull.com/` and REST audience
`https://api.wally.luminull.com` are fixed in application configuration and the release.
The web bundle receives the provider and SPA client ID at build time; changing repository
variables does not change a deployed bundle. Existing Firebase build variables remain
required for the rollback path. These switches do not provision Auth0 tenant settings,
import accounts, or grant connector access. Complete the [Auth0 activation checks](AUTH0.md)
before opting in. Keep all switches off and provider `firebase` for the default release.

**Repository secrets:** retain `E2E_USER_EMAIL` and `E2E_USER_PASSWORD` for Firebase
rollback tests. Auth0 validation uses `E2E_AUTH0_USER_PASSWORD` with the account email
and subject stored as repository variables. Keep a separate password under that same
secret name in Dependabot secrets, alongside its separate account variables. See the
[E2E setup](../apps/web/e2e/README.md) for provider selection and isolated HTTPS routing.

> There is deliberately **no service-account key anywhere.** The organization enforces
> `iam.disableServiceAccountKeyCreation`, and the API no longer needs one outside Google
> Cloud when it is pointed at an emulator (section 5).

### Why traces are disabled in CI

A Playwright trace records every action's input value verbatim, including
`getByLabel('Passwort').fill(PASSWORD)` in `e2e/support.ts`, plus full request bodies and
`Authorization` headers. Actions artifacts on a public repository are downloadable by anyone
with the run URL, and GitHub's log masking does not apply to artifact contents. So
`playwright.config.ts` sets `trace: 'off'` and `video: 'off'` under CI, and the workflow
uploads only `playwright-report/` — never `test-results/`. If you ever turn traces back on,
rotate the E2E password afterwards.

## Board safety rollout

Ship the enforced API and matching web bundle from the **same release**. The release workflow
builds and validates both artifacts before shifting API traffic and publishing Hosting. There
is a short handover between services; old tabs receive `428 PRECONDITION_REQUIRED` and must
refresh. Do not temporarily disable preconditions. Keep drafts for review before refreshing.
The release remains subject to the existing CI and production environment approval gates.

Before promotion:

1. Deploy `firestore.indexes.json`, including all five TTL policies, `boardOperations.expiresAt`,
   `assistantAudit.expiresAt`, `assistantConversations.expiresAt`,
   `assistantAttempts.expiresAt` and `assistantSuggestions.expiresAt`, to the configured named
   database. Confirm all five TTL policies are active in Firestore. TTL removal is
   asynchronous, usually within 24 hours after expiry; seven days (receipts, assistant
   attempts and assistant suggestions, whose receipts expire with them) and 30 days (assistant
   audit records, and assistant conversations after their last turn) are retention targets,
   not exact erasure times. Do not enable TTL on `boardCleanup`.
2. Run the reconciliation command below against the intended database in dry-run mode.
   Review its counts, then apply repairs if needed. Repairs re-read each board transactionally.
3. Run emulator/browser tests, lint, typecheck and build. The full authenticated Playwright
   suite additionally needs the existing `E2E_USER_EMAIL` and `E2E_USER_PASSWORD` secrets.
4. Release both artifacts; check response revision headers, 428 for missing mutation
   metadata, 409 on stale writes, successful same-key replay, and browser draft review on
   the disposable test environment. Production smoke checks remain read-only.

No revision backfill is necessary: legacy records read as zero and their first substantive
change becomes one. Reconciliation rebuilds role caches from active membership records and
removes share-link documents that are not a board's current token.

Local Docker commands (emulator only):

```bash
docker compose exec api pnpm --filter @wally/api maintenance
docker compose exec api pnpm --filter @wally/api maintenance --apply
docker compose exec api pnpm --filter @wally/api maintenance --cleanup
```

With the production API image and its existing database identity/configuration, the compiled
entry point is `node dist/maintenance.js`; the same flags apply. `--cleanup` performs writes
and drains durable jobs even without `--apply`; `--apply` applies reconciliation repairs.
The command exits nonzero when requested cleanup remains pending. Run it after any
`cleanup_pending` outcome and monitor the remaining count; jobs do not expire until completed.
A repeated deletion request also retries its cleanup while its receipt is retained.

Rollback API and Hosting together through the release procedure. Keep receipts, revisions,
and pending cleanup records intact across rollback; never restore deleted notes from old
client drafts. Reverting to an older API also reverts enforcement, so prefer a forward fix
once writes have resumed.
