# Retire Firebase: Firestore, Hosting and Firebase Authentication (migration workstream 6, part 1) — design

> **Status:** approved by the owner and done, 2026-11-01: code in #93, live since v0.14.0; the resource groups A–C ran the same day (DEPLOY, Firebase retired).

Date: 2026-11-01. Part of workstream 6 (decommission) of the
[platform migration](../../rfcs/RFC-0011-platform-migration.md). Auth0 is the other half of
workstream 6. It is retired with the Supabase Auth cutover (workstream 3) and is not part of
this design.

## Intent

Firebase no longer serves production:

- Data has been on Supabase PostgreSQL since v0.12.0.
- The web app has been on Cloudflare since v0.13.0.
- Production sign-in has been Auth0 since v0.8.3.

Firebase is still present in three ways:

1. **Firebase Authentication is still a live code path.** It signs in local development and
   CI:
   - The API verifies any token that is not an Auth0 token with `firebase-admin`, and uses
     its uid directly as the Wally user id.
   - The web app runs a Firebase sign-in UI whenever `VITE_AUTH_PROVIDER` is not `auth0`.
   - CI E2E defaults to Firebase.
   - 13 API test files sign in through a fake Firebase verifier.

   The owner decided on 2026-11-01 that Firebase Authentication goes completely, now. This
   replaces two earlier positions:
   - the 2026-10-27 position that CI stays on Firebase;
   - RFC-0011 §6's order, which retired Firebase Authentication only with Auth0.

2. **Live resources in `luminull-wally`:**
   - the Firestore database `wally`;
   - the Hosting site with `wally.luminull.com` still attached;
   - Firebase Auth with 9 accounts;
   - a web app registration and its browser API key;
   - the Admin SDK service account with a user-managed key;
   - IAM roles granted for Firestore;
   - about a dozen Firebase APIs.
3. **Leftovers in config, docs and comments.**

After this work, nothing in the repository or the project depends on Firebase. Auth0 is the
only sign-in everywhere: production, local development and CI. Workstream 3 later replaces
it with Supabase Auth.

## Goals

1. Remove every Firebase code path, dependency (`firebase`, `firebase-admin`) and setting
   from the API, the web app, compose, CI, the release and the scripts.
2. Make Auth0 the only sign-in, in local development and CI as well. CI already has a
   complete Auth0 E2E path, behind the `auth0-validation` label.
3. Bring every doc that describes Firebase as current up to date in the same PR, including
   the ADR and RFC index **In production** cells.
4. Give the owner exact commands to delete every Firebase resource. After each group, verify
   read-only that it is gone.

## Non-goals

- Retiring Auth0 or starting Supabase Auth (workstream 3).
- Deleting the Google Cloud project. Cloud Run, Artifact Registry, Secret Manager, Workload
  Identity Federation and Vertex AI live in it.
- Detaching Firebase from the project. Google documents that "once you 'add Firebase' to an
  existing Google Cloud project, it can't be undone"
  ([existing Cloud project](https://firebase.google.com/docs/projects/use-firebase-with-existing-cloud-project)).
  The project stays a Firebase project, with no Firebase product, account or data left in it.
- Rewriting history: past plans and specs under `docs/superpowers/`, and historical
  sections such as the ADR-0024 data reset, stay as they are.
- Anything Auth0-specific beyond what removing the provider switch requires.

## Anti-goals

- **A test-only sign-in path in production code.** The API keeps exactly one way to accept a
  token, the Auth0 verifier. Tests replace it through the existing `auth0Verifier` injection
  point.
- **Weakening any Auth0 guarantee to make local development easier.** That includes
  persisting tokens in local storage, skipping consent, or making the API accept unverified
  tokens locally.
- **Deleting a resource while something on `main` still uses it.** See the order of
  operations below.

## What the owner decided

- Firebase Authentication is removed completely, now (2026-11-01).
- The owner runs every destructive command. Claude provides the commands and verifies
  read-only afterwards.
- One PR from `main`, with CI green.

- Side-by-side previews of a branch (a second web app on another localhost port) are not
  kept (2026-11-01). Auth0 accepts only `http://localhost:5174` locally, and no preview port
  is registered. If the owner wants a preview later, they ask, and a port is registered in
  the Auth0 SPA client then. Web changes are verified by CI's E2E, and on `:5174` after
  merge.

## Calls made in this design (Claude's; the owner can overrule any)

1. **No provider switches left.** Removed: `VITE_AUTH_PROVIDER`, `AUTH0_ENABLED`,
   `E2E_AUTH_PROVIDER` and the `auth0-validation` label logic. With one provider, each
   switch either has one valid value or turns sign-in off. Workstream 3 designs its own
   transition. `AUTH0_SIGNUP_ENABLED` stays, because production, CI and local development
   want different values.
2. **Local development signs up through Auth0.** `.env.example` sets
   `AUTH0_SIGNUP_ENABLED=true` and asks for the public `VITE_AUTH0_CLIENT_ID`. The first
   local sign-in creates a local user and board in the local database only:
   - It uses the same Auth0 tenant as production. There is only one, and `localhost:5174` is
     already an allowed callback ([AUTH0.md](../../AUTH0.md)).
   - `make seed` still creates the demo owner. Signing in as that user needs an Auth0
     database account bound with `seed-auth0-e2e.ts`, as CI does.
   - No local data is lost. The live stack's database had 0 users, boards and notes
     (checked 2026-11-01). Otherwise a Firebase-uid user would block the owner's first Auth0
     sign-in: `resolveOrCreateIdentity` refuses an email that already belongs to a user.
3. **Local E2E becomes CI-only.** Auth0 shows a login confirmation after every reload on a
   `localhost` callback. Auth0 documents that the prompt "may still appear … when the
   application uses a non-verifiable callback URI (such as `localhost` …)"
   ([consent](https://auth0.com/docs/get-started/applications/confidential-and-public-applications/user-consent-and-third-party-applications)).
   The E2E README already records this. Only CI's disposable HTTPS setup avoids it, and
   that setup maps the production hostnames to loopback, which must not be done on a
   laptop. This matches the standing practice of verifying E2E in CI.
4. **The Vertex project comes only from `ASSISTANT_VERTEX_PROJECT`.** It previously fell
   back to `FIREBASE_PROJECT_ID`:
   - The release sets it from `GCP_PROJECT_ID` in `apiConfig`, where `FIREBASE_PROJECT_ID`
     was.
   - `env.ts` requires it at boot when `ASSISTANT_ENABLED=true`.
   - The live local `.env` already has it.
5. **No new ADR.** ADR-0016 already says it "replaces ADR-0004's Firebase-specific identity
   source" and that "local/CI authentication guidance in ADR-0009 must be reconciled".
   This PR does that reconciliation:
   - ADR-0009's status becomes "accepted; its Firestore emulator superseded by ADR-0025,
     its Firebase Authentication by ADR-0016". The README allows status changes.
   - The index cells for ADR-0003, ADR-0004 and ADR-0009 say what is no longer in effect,
     and since when.
6. **Comments.** Comments that describe Firestore or Firebase as current are corrected.
   Comments that explain why something has its shape keep their history, for example ids
   shaped like Firestore auto-ids, or what Firestore's TTL did. `firestoreId` in the shared
   schemas becomes a neutral name.
7. **The in-app privacy text (en and de) matches GDPR.md's processor list.** It currently
   names "legacy Firebase login infrastructure" and says Google provides the database, which
   has been Supabase since v0.12.0. The German text is a catalogue string, which the
   English-only rule allows. The owner sees both versions in the PR.
8. **Retiring the Firebase Hosting site means disabling it.** Google documents: "you cannot
   delete the default site, which has the same `SITE_ID` as your Firebase project ID"
   ([multiple sites](https://firebase.google.com/docs/hosting/multisites)). A `SITE_DISABLE`
   release makes Hosting act "as if the site never existed" (Hosting API v1beta1 `Release.type`).
   The site's old versions stay stored. They hold only the public SPA bundle.
9. **The web app registration is removed with the 30-day restore window** (Firebase
   Management API `webApps.remove` without `immediate`). The browser API key is deleted, and
   API keys can be restored for 30 days (API Keys API `keys.delete`). Both windows cost
   nothing and cover a mistake.
10. **`firebase.googleapis.com` stays enabled.** Google warns that disabling the services
    "add Firebase" enabled "could cause unexpected and unintended consequences due to
    dependencies". Every Firebase product API is disabled.

## The change, by area (for the plan to detail)

### API (`apps/api`)

- **Delete:** `plugins/firebase.ts`, `lib/firebase-app.ts` and the `firebase-admin`
  dependency.
- **The auth plugin** passes every bearer token to the Auth0 verifier, which checks issuer
  and audience itself. The unverified issuer pre-check goes, because no other verifier
  remains:
  - The identity is always resolved through `auth_identities`.
  - The direct-uid provisioning path (`provisionUser(..., !externalIdentity)`) goes.
  - With signup off and no binding, the API answers 403 `IDENTITY_NOT_LINKED`, as today.
  - The comments say "the sign-in provider" or "Auth0" where they said Firebase.
- **`app.ts`:**
  - `authVerifier` is no longer a build option.
  - The Auth0 verifier is always created unless one is injected.
  - The plugin dependency `firebase-plugin` goes.
- **`env.ts`:** `FIREBASE_PROJECT_ID` and `AUTH0_ENABLED` go, and `ASSISTANT_VERTEX_PROJECT`
  is required when the assistant is on (call 4). The `assistant/model` functions that pick
  `FIREBASE_PROJECT_ID` from env drop it.
- **Tests:**
  - The fake becomes an `AccessTokenVerifier`: token string → external identity, with
    issuer = Auth0's issuer and subject chosen by the test.
  - The helper keeps a simple surface: a test registers a token for a user id, and the
    helper creates the user row and binds the identity.
  - Tests that assert first-request provisioning use the signup path.
  - Tests that only existed to prove "no Firebase fallback" go or are reworded.
  - The plan reads the 13 affected files and picks the helper shape.
- **Scripts:** `migrate-cli` runs without `FIREBASE_PROJECT_ID` (DEPLOY §7 and release.yml
  pass it today only because `env.ts` requires it). Check that the migrator's env needs
  nothing else.

### Web (`apps/web`)

- **Delete:**
  - `features/auth/firebase.ts`, `firebase.test.ts` and `FirebaseAuthProvider`;
  - `SignInForm.tsx`, `SignUpForm.tsx` and their tests;
  - the Firebase-only tests in `AuthProvider.test.tsx`;
  - the `firebase` dependency.
- **`AuthProvider`** is `Auth0SessionProvider`, and `getFreshIdToken` delegates to
  `getAuth0AccessToken`.
- **`AuthContextValue`** loses the Firebase-only members: `signInWithEmail`,
  `signUpWithEmail`, `signInWithGoogle`, `resendVerificationEmail` and
  `verificationSendFailed`. `hostedLogin` becomes required. Callers and test fakes are
  updated.
- **The login and signup pages** always render `HostedLogin`.
- **`EmailVerificationBanner`** keeps only its hosted-login branch.
- **Config:**
  - i18n keys used only by the deleted forms are removed from both catalogues. The parity
    test keeps them aligned.
  - `vite-env.d.ts` and `vitest.config.ts` drop the `VITE_FIREBASE_*` and
    `VITE_AUTH_PROVIDER` entries.
  - `apps/web/.env.example` describes Auth0 only.
- **E2E:** `support.ts` has no provider switch, and `playwright.config.ts` comments stop
  naming Firebase.

### Shared (`packages/shared`)

- `firestoreId` is renamed in the assistant and tidy schemas (call 6). The behaviour is
  unchanged.
- Comments in `customField.ts`, `me.ts` and `enums.ts` that describe Firestore or Firebase
  as current are corrected.

### Compose, CI, release, scripts, repo config

- **Compose:**
  - `docker-compose.yml` drops `FIREBASE_PROJECT_ID`, and `VITE_AUTH_PROVIDER` with its
    Firebase default.
  - The web service requires `VITE_AUTH0_CLIENT_ID` with a readable error when it is unset.
  - `docker-compose.mcp-local.yml` drops `FIREBASE_PROJECT_ID`.
- **`.env.example`:**
  - removes the Firebase block;
  - documents `VITE_AUTH0_CLIENT_ID`, `AUTH0_SIGNUP_ENABLED=true` for local, and
    `ASSISTANT_VERTEX_PROJECT`.
- **`ci.yml`:**
  - The unit-test job has no `FIREBASE_PROJECT_ID`.
  - The E2E job always runs the Auth0 path, with no provider expression and no label. It
    generates `.env` and the HTTPS setup unconditionally, and reads only the Auth0
    variables and secret.
  - The vacuous-green guard is unchanged.
- **`release.yml`:**
  - no `VITE_AUTH_PROVIDER` or `AUTH0_ENABLED` validation or variables;
  - no `VITE_FIREBASE_*` build variables;
  - the migrations step drops `FIREBASE_PROJECT_ID`;
  - the web build requires `VITE_AUTH0_CLIENT_ID`.
- **`scripts/resolve-release-image.mjs` and its test:** `ASSISTANT_VERTEX_PROJECT`
  replaces `FIREBASE_PROJECT_ID`, and `AUTH0_ENABLED` goes.
- **`scripts/bootstrap-gcp-cicd.sh`:**
  - no longer enables `firebase.googleapis.com`;
  - its printed `gh variable set` list drops the Firebase variables and secrets, and
    `E2E_AUTH_PROVIDER`.
- **`.firebaserc`** at the repo root, still tracked, is deleted.
- **`app.ts`** mounts MCP behind `MCP_ENABLED` alone, since `AUTH0_ENABLED` is gone.
- **Repo config:** `.github/CODEOWNERS` loses the `firestore.rules` and
  `firestore.indexes.json` lines. The `.github/actions/setup` comment drops "the Firebase
  CLI".

### Docs (same PR)

- **`docs/DEPLOY.md`:** every section that names Firebase or Firestore as current:
  - §1 identity paragraph, §2 names table, and §3 billing (via Cloud Billing, not the
    Firebase console);
  - §5's `firebase-app.ts` and `plugins/firebase.ts` bullets;
  - §6's `firebase use --add` and `.firebaserc` text, which is stale, and the
    `firestore.googleapis.com` line;
  - the §7 migrations command, §9a `datastore.user`, the §9b env list and §9c;
  - §10a `VITE_FIREBASE_*`;
  - §11, "Let Firebase Auth trust your new domain", which is deleted, along with its
    troubleshooting pointer;
  - the §17 E2E notes.

  "Firestore after the switch" and the roles text that keeps `firebaserules.admin` and
  `datastore.indexAdmin` "until Firestore is retired" are replaced by a short **Firebase
  retired** record. It lists what was deleted, on which date, and what stays: the default
  Hosting site, disabled, and the irreversible Firebase attachment.

- **The other docs:**
  - `docs/AUTH0.md`: Configuration and the local run;
  - `docs/SETUP.md`, the root `README.md` and `docs/architecture/overview.md`;
  - `docs/README.md`;
  - `docs/GDPR.md`: the processor row, §§ on data locations, sign-in and erasure, and the
    `firestore.rules` line;
  - `apps/web/e2e/README.md`: Auth0 only; local runs are CI-only (call 3);
  - wherever SETUP or AUTH0.md describes running a branch on another port: one line saying
    a preview port must first be registered in the Auth0 SPA client;
  - `docs/SPEC.md`, where it describes Firebase as current.
- **ADR index:** cells for ADR-0003, ADR-0004, ADR-0008 and ADR-0009, ADR-0009's status
  (call 5), and the "Last checked" line.
- **RFC index:** the RFC-0011 row and the "Last checked" line.
- **RFC-0011:**
  - the §4 status: workstream 6's Firebase part done, Auth0 left for workstream 3;
  - §6's decommission list: the Firebase items marked done with dates, and the note that
    Firebase Authentication went before the identity cutover by owner decision.
  - The released version is filled in when the owner tags.

## Live resources: order of operations

Resources are deleted only once nothing on `main` uses them:

- **Group A** can run now.
- **Group B** runs after the PR merges: `main`'s CI must already sign in with Auth0, and
  the live local stack must already have moved to Auth0.
- **Group C** runs after the release that carries the PR.

Claude verifies each group read-only before the next one starts.

All commands are for project `luminull-wally` (number 128432325938). REST calls use:

```sh
T=$(gcloud auth print-access-token)
H=(-H "Authorization: Bearer $T" -H "x-goog-user-project: luminull-wally")
```

### Group A — independent of the code (any time)

1. **Firestore database `wally`** (europe-west3; delete protection is already off). This
   also removes its TTL policies and indexes:

   ```sh
   gcloud firestore databases delete --database=wally --project=luminull-wally
   ```

   The command is from Google's
   [manage databases](https://docs.cloud.google.com/firestore/docs/manage-databases) page.

2. **Hosting custom domain `wally.luminull.com`.** It is listed as `HOST_ACTIVE` although
   the console removal was attempted, while DNS already points at Cloudflare:

   ```sh
   curl -s -X DELETE "${H[@]}" "https://firebasehosting.googleapis.com/v1beta1/projects/luminull-wally/sites/luminull-wally/customDomains/wally.luminull.com"
   ```

   A deleted custom domain persists for about 30 days, then Hosting removes it completely
   (`CustomDomain.deleteTime`, Hosting API v1beta1). If the legacy listing still shows the
   domain afterwards:

   ```sh
   curl -s -X DELETE "${H[@]}" "https://firebasehosting.googleapis.com/v1beta1/sites/luminull-wally/domains/wally.luminull.com"
   ```

3. **Disable the default Hosting site** (call 8):

   ```sh
   curl -s -X POST "${H[@]}" -H 'Content-Type: application/json' -d '{"type":"SITE_DISABLE"}' "https://firebasehosting.googleapis.com/v1beta1/sites/luminull-wally/releases"
   ```

4. **IAM roles granted for Firestore and its rules:**

   ```sh
   gcloud projects remove-iam-policy-binding luminull-wally --member=serviceAccount:github-deployer@luminull-wally.iam.gserviceaccount.com --role=roles/firebaserules.admin
   gcloud projects remove-iam-policy-binding luminull-wally --member=serviceAccount:github-deployer@luminull-wally.iam.gserviceaccount.com --role=roles/datastore.indexAdmin
   gcloud projects remove-iam-policy-binding luminull-wally --member=serviceAccount:wally-api@luminull-wally.iam.gserviceaccount.com --role=roles/datastore.user
   ```

5. **Local leftovers.** `~/wally-emulator-data` is empty; the other two are untracked files
   in the live checkout:

   ```sh
   rmdir ~/wally-emulator-data
   rm -rf ~/development/apps/wally/.firebase ~/development/apps/wally/docker-compose.override.yml.firestore-retired
   ```

**Verify (Claude):**

- `gcloud firestore databases list` shows no `wally`.
- The custom domain shows a `deleteTime`, or is absent from both listings.
- The newest Hosting release is `SITE_DISABLE`, and `https://luminull-wally.web.app` no
  longer serves the app.
- The IAM policy has no `firebaserules` or `datastore` role for either account.

### Group B — after the PR is merged

6. **The live local stack moves to Auth0.** In `~/development/apps/wally/.env`:
   - remove the seven `FIREBASE_*`/`VITE_FIREBASE_*` lines, including
     `FIREBASE_PRIVATE_KEY`;
   - add `VITE_AUTH0_CLIENT_ID` (the public SPA client id) and `AUTH0_SIGNUP_ENABLED=true`.

   Then pull `main` and rebuild the images, because dependencies were removed:

   ```sh
   docker compose up -d --build
   ```

   Open pull requests (including Dependabot's) are rebased so they run the Auth0 E2E path.

7. **Firebase Auth accounts** (9, including real people's addresses). The batch API deletes
   only disabled accounts unless `force` is set
   (Identity Toolkit v1 `accounts:batchDelete`):

   ```sh
   ids=$(curl -s "${H[@]}" "https://identitytoolkit.googleapis.com/v1/projects/luminull-wally/accounts:batchGet?maxResults=1000" | jq -c '[.users[].localId]')
   curl -s -X POST "${H[@]}" -H 'Content-Type: application/json' -d "{\"localIds\":$ids,\"force\":true}" "https://identitytoolkit.googleapis.com/v1/projects/luminull-wally/accounts:batchDelete"
   ```

8. **Sign-in providers off** (Identity Toolkit admin v2):

   ```sh
   curl -s -X PATCH "${H[@]}" -H 'Content-Type: application/json' -d '{"signIn":{"email":{"enabled":false}}}' "https://identitytoolkit.googleapis.com/admin/v2/projects/luminull-wally/config?updateMask=signIn.email.enabled"
   curl -s -X DELETE "${H[@]}" "https://identitytoolkit.googleapis.com/admin/v2/projects/luminull-wally/defaultSupportedIdpConfigs/google.com"
   ```

9. **The web app registration and its browser API key** (call 9):

   ```sh
   curl -s -X POST "${H[@]}" -H 'Content-Type: application/json' -d '{}' "https://firebase.googleapis.com/v1beta1/projects/luminull-wally/webApps/1:128432325938:web:d16bdb15c4ce0cc0a6c32b:remove"
   gcloud services api-keys delete projects/128432325938/locations/global/keys/975b6596-77de-44bf-9bad-f7841f9f1938 --project=luminull-wally
   ```

10. **The Admin SDK service account and its user-managed key.** The key was created
    2026-09-18 and is the one in the local `.env`. Remove its role bindings first, so that
    no `deleted:` members are left in the policy:

    ```sh
    SA=firebase-adminsdk-fbsvc@luminull-wally.iam.gserviceaccount.com
    gcloud iam service-accounts keys delete e0a5ea36fe339dc75922f69d1abfcc3a35304691 --iam-account=$SA
    gcloud projects remove-iam-policy-binding luminull-wally --member=serviceAccount:$SA --role=roles/firebaseauth.admin
    gcloud projects remove-iam-policy-binding luminull-wally --member=serviceAccount:$SA --role=roles/firebase.sdkAdminServiceAgent
    gcloud iam service-accounts delete $SA --project=luminull-wally
    ```

11. **Firebase product APIs** (call 10). If gcloud names a dependent that is on this list,
    re-run with `--force`. If it names any other dependent, stop and ask.

    ```sh
    gcloud services disable identitytoolkit.googleapis.com securetoken.googleapis.com firebasehosting.googleapis.com firebaserules.googleapis.com firestore.googleapis.com datastore.googleapis.com fcm.googleapis.com fcmregistrations.googleapis.com firebaseinstallations.googleapis.com firebaseremoteconfig.googleapis.com firebaseremoteconfigrealtime.googleapis.com firebaseappdistribution.googleapis.com testing.googleapis.com --project=luminull-wally
    ```

12. **GitHub configuration** that only Firebase used:

    ```sh
    for v in FIREBASE_PROJECT_ID VITE_FIREBASE_API_KEY VITE_FIREBASE_AUTH_DOMAIN VITE_FIREBASE_PROJECT_ID VITE_FIREBASE_APP_ID; do gh variable delete $v --repo milad-luminull/wally; done
    gh secret delete E2E_USER_EMAIL --repo milad-luminull/wally
    gh secret delete E2E_USER_PASSWORD --repo milad-luminull/wally
    gh secret delete E2E_USER_EMAIL --repo milad-luminull/wally --app dependabot
    gh secret delete E2E_USER_PASSWORD --repo milad-luminull/wally --app dependabot
    gh label delete auth0-validation --repo milad-luminull/wally --yes
    ```

**Verify (Claude):**

- `accounts:batchGet` returns no users.
- The config shows email sign-in off, and no Google IdP config exists.
- The web app is `DELETED`, and the API key list is empty.
- The service account and its key are gone.
- None of the listed APIs is enabled, and only the expected Google-managed bindings remain.
- The listed variables, secrets and label are gone.
- A fresh CI run on `main` is green.

### Group C — after the release that carries the PR

13. **Production environment variables** that the new release no longer reads:

    ```sh
    gh variable delete AUTH0_ENABLED --repo milad-luminull/wally --env production
    gh variable delete VITE_AUTH_PROVIDER --repo milad-luminull/wally --env production
    ```

**Verify (Claude):**

- The serving Cloud Run revision has no `FIREBASE_PROJECT_ID` or `AUTH0_ENABLED` and has
  `ASSISTANT_VERTEX_PROJECT`.
- `/health` is ok.
- Sign-in at `https://wally.luminull.com` reaches the Auth0 login page.
- The release smoke test passed.

## Rollback

- **Code:** the API's earlier Cloud Run revisions still boot. They carry
  `FIREBASE_PROJECT_ID` in their own revision env, and production never verifies a Firebase
  token. So rolling back by Cloud Run revision (DEPLOY "Rolling back") works after every
  group. The web Worker's earlier versions use Auth0 and are unaffected.
- **Resources:** each is restorable only as follows:
  - Firestore deletion is final, and the data was already deleted at v0.11.0 (ADR-0024).
  - The custom domain, the web app and the API key have 30-day restore windows.
  - Firebase Auth accounts and the service-account key are final. Production never used
    them.
  - APIs and IAM bindings can be re-enabled or re-granted.

## Unverified (to confirm while running the commands)

- Whether deleting the `customDomains` entry also clears the legacy `sites/…/domains`
  listing. Command 2 covers both.
- Why the console removal of the custom domain did not take effect. Command 2's response
  will show whether an operation was already pending.
- Whether Firebase recreates `firebase-adminsdk-fbsvc` on a later console visit. If it
  does, it holds no key and no role.
- Whether disabling `identitytoolkit`/`securetoken` before or after step 8 matters. Step 8
  runs first so the config change uses the enabled API.

## Done when

- The owner has approved this design.
- One PR from `main` removes the code and updates the docs, with CI green, and its E2E runs
  on Auth0 with the regular identity. The Auth0 path last passed on PR #66 through the
  `auth0-validation` label.
- The Dependabot identity is proven by the first Dependabot PR after the merge, which
  takes the bot branch of the variables. If none arrives within a few days, the owner
  triggers one with "Check for updates" on the repository's Dependabot page. Until a bot
  run passes, a failing Dependabot E2E is treated as this change's to fix.
- The owner has run groups A to C, and Claude has verified each read-only.
- Memory and the shared notes record the result.
