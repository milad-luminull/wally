# Retire Firebase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every Firebase code path, dependency and setting, and make Auth0 the only
sign-in in production, local development and CI. Update every affected doc in the same PR.

**Architecture:**

- **API:** the API keeps one way to accept a token, the Auth0 verifier. Users are always
  resolved through `auth_identities` and created only by `resolveOrCreateIdentity`.
  Tests inject a fake `AccessTokenVerifier` and a `newUserId` policy through `buildApp`, so
  existing fixtures keep their chosen user ids without a second sign-in path.
- **Web:** the web app always runs `Auth0SessionProvider`.
- **CI:** CI always runs the Auth0 E2E path that already exists.

**Tech Stack:** Fastify 5, Drizzle/PostgreSQL, jose, React 19/Vite, Vitest, Playwright,
GitHub Actions, Docker Compose.

**Spec:** [`docs/superpowers/specs/2026-11-01-retire-firebase-design.md`](../specs/2026-11-01-retire-firebase-design.md)
(approved by the owner 2026-11-01). Read it first: "Calls made in this design" numbers 1–10
are referenced below as "call N".

## Global Constraints

- **Worktree:** `/Users/mr_user/development/apps/wally-retire-firebase`, branch
  `chore/retire-firebase`, from `origin/main` ace2da73. Never touch or switch branches in
  the main checkout `/Users/mr_user/development/apps/wally`.
- **Code and test data are English.** Only i18n catalogues may hold German.
- **The repo never names Finlex**, not even in test data.
- **No test-only sign-in path in production code.** Tests replace the verifier only through
  `buildApp({ auth0Verifier })`.
- **Never** persist tokens in local storage, skip consent, or accept unverified tokens
  locally.
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Nothing is pushed** until Task 8.
- **Tests run on the host** against a throwaway Postgres container, not the live stack's:
  ```bash
  docker run -d --name wally-pg-retire-firebase -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55433:5432 supabase/postgres:17.11.0.003
  export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/postgres
  ```
  `pnpm install` once in the worktree. Remove the container after the PR merges.
- **Per-package checks:** `pnpm --filter <pkg> test`, `pnpm --filter <pkg> typecheck`,
  `pnpm --filter <pkg> lint`.
- **Whole-workspace checks** at the end: `pnpm turbo run lint typecheck build test` and
  `pnpm run format:check`.
- **Leave untouched:** historical documents under `docs/superpowers/plans|specs/` (other
  than this plan and its spec), `docs/researches/`, and RFCs and ADRs other than those named
  in Task 7. Accepted ADR bodies may change only in their status line.

## Review Focus

1. **The sign-up email collision:**
   - A user with a stored email exists, and a different identity signs in with signup on,
     using the same email (verified or not).
   - Expected: 403 `IDENTITY_NOT_LINKED`, no user is created, and no invite is activated.
   - The Firebase path used to create the second user. Tests that relied on that must now
     assert the refusal. Pinned in Task 1.
2. **Signup off with no binding:**
   - A valid token for an unknown subject, with `AUTH0_SIGNUP_ENABLED=false`.
   - Expected: 403 `IDENTITY_NOT_LINKED`, and no user or board written. Pinned in Task 1.
3. **A bound identity whose user row was deleted:**
   - Expected: 403, never a recreated user. With signup on, it must not create a new user,
     because the mapping cascades away and the email is free.
   - Pin the actual behaviour in Task 1 and say in the test name which one it is.
4. **The assistant on, with no Vertex project:**
   - Expected: boot fails with a readable error naming `ASSISTANT_VERTEX_PROJECT`, rather
     than a 500 on the first assistant call. Pinned in Task 2.
5. **The compose web service with `VITE_AUTH0_CLIENT_ID` unset:**
   - Expected: `docker compose config` fails with a message naming the variable, rather
     than a web app that renders and then fails at sign-in. Checked in Task 4.

---

### Task 0: Commit the plan

- [ ] **Step 1:** `git add docs/superpowers/plans/2026-11-01-retire-firebase.md && git commit -m "docs: plan for retiring Firebase"`

### Task 1: API signs in through Auth0 only

**Files:**

- Delete: `apps/api/src/plugins/firebase.ts`, `apps/api/src/lib/firebase-app.ts`
- Modify:
  - `apps/api/src/plugins/auth.ts`, `apps/api/src/app.ts`;
  - `apps/api/src/lib/auth/identities.ts`;
  - `apps/api/src/routes/mcp.ts:46`;
  - `apps/api/src/env.ts` (remove `AUTH0_ENABLED`) and `apps/api/package.json` (remove
    `firebase-admin`).
- Tests:
  - `apps/api/test/helpers.ts`;
  - `auth.test.ts`, `auth0.test.ts`, `auth0-signup.test.ts`, `me.test.ts`,
    `invite-security.test.ts`, `membership-integrity.test.ts`, `connections.test.ts`,
    `mcp.test.ts`, `health.test.ts`;
  - `apps/api/src/env.test.ts`;
  - any test that sets `AUTH0_ENABLED`.

**Interfaces:**

- **Produces:**
  - `resolveOrCreateIdentity(db, identity: VerifiedIdentity, language: Language, newUserId: (identity: VerifiedIdentity) => string = () => randomUUID()): Promise<{ userId: string; created: boolean }>`.
  - `BuildAppOptions`:
    - `authVerifier` is removed;
    - `auth0Verifier?: AccessTokenVerifier` is kept;
    - `auth0SignupEnabled?: boolean` is kept;
    - add `newUserId?: (identity: VerifiedIdentity) => string`.
  - The test helpers keep their signatures: `registerTestUser(ctx, uid, email, name?, emailVerified?) => string`, `ctx.tokens: Map<string, TestIdentity>` where
    `TestIdentity = { uid: string; email: string; emailVerified: boolean; name: string | null }`.
    `DecodedAuthToken` is no longer imported from the deleted plugin; `TestIdentity` is
    declared in `helpers.ts`.

**Behaviour:**

- **The auth plugin's preHandler:**
  1. A missing or empty bearer token → 401, unchanged.
  2. `identity = await options.verifier.verify(token)`, with no `decodeJwt` issuer
     pre-check. Any throw → 401 `Invalid token`.
  3. A missing email → 401, unchanged.
  4. `signupEnabled` → `resolveOrCreateIdentity(db, identity, signupLanguage, newUserId)`.
     Otherwise `resolveIdentity`.
  5. A missing user row → 403 `IDENTITY_NOT_LINKED`.
  6. If email, displayName or emailVerified differ, `syncProfile` updates them.
  7. Invite sweep `if (emailVerified && (created || profileChanged))`.
- **`provisionUser` becomes `syncProfile(db, userId, email, displayName, emailVerified): Promise<{ user: UserRow; changed: boolean }>`.** It is update-only, and its create
  and first-board branches go. `resolveOrCreateIdentity` creates the user and board.
- **Plugin options become** `{ verifier: AccessTokenVerifier; signupEnabled: boolean; newUserId?: ... }`, and the dependency is only `postgres-plugin`.
- **`app.ts`** always builds `createAuth0Verifier({ issuer: AUTH0_ISSUER, audience: AUTH0_AUDIENCE })` unless one is injected. MCP mounts on `env.MCP_ENABLED` alone, and so
  does `routes/mcp.ts:46` (`options.enabled ?? env.MCP_ENABLED`).
- **Comments** say "the sign-in provider (Auth0)" where they said Firebase, including the
  invite-sweep rationale.

- [ ] **Step 1: Rewrite the test seam in `helpers.ts`, then run the suite to see it fail.**
  - `createFakeAuthVerifier()` returns `{ verifier: AccessTokenVerifier, tokens: Map<string, TestIdentity> }`.
    `verify(token)` maps a registered token to
    `{ issuer: AUTH0_ISSUER, subject: \`test|${uid}\`, email, emailVerified, name }` and
    throws for unknown tokens.
  - `buildTestApp` passes `auth0Verifier: verifier`, `auth0SignupEnabled: true` (overridable
    by an option) and `newUserId: (identity) => identity.subject.slice('test|'.length)`.
    Fixtures therefore keep ids such as `fx-owner`.
  - Run `pnpm --filter @wally/api test`. Expected: compile errors, because `authVerifier`
    is still on `BuildAppOptions` and `plugins/firebase.ts` still exists.
- [ ] **Step 2: Add the Review Focus tests to `auth.test.ts`.**
  - `refuses a second identity whose email already belongs to a user, and activates nothing`:
    - register `a-owner`, then a different uid with the same email (verified);
    - expect 403 `IDENTITY_NOT_LINKED`;
    - expect no user row for the second uid and the pending invite still `PENDING`.
  - `refuses an unknown identity when signup is off and writes nothing`: build with
    `auth0SignupEnabled: false`, expect 403, and expect no user or board row.
  - `refuses a bound identity whose user record is gone` (Review Focus 3):
    - sign in once, delete the user row with `db.delete(users)`, sign in again;
    - assert the actual outcome. With the mapping cascaded and signup on, a new user would
      be created: if so, name the test `creates a new account when the user record and its mapping are gone`
      and assert the new row.
    - Do not change production behaviour for this, and note the result in the PR body.
- [ ] **Step 3: Implement the plugin, `identities.ts`, `app.ts`, `mcp.ts` and `env.ts` changes above.** Delete `plugins/firebase.ts` and `lib/firebase-app.ts`, and remove `firebase-admin`
      (`pnpm --filter @wally/api remove firebase-admin`).
- [ ] **Step 4: Fix the remaining tests.**
  - Tests that asserted Firebase-specific behaviour are deleted or reworded:
    - `auth0.test.ts` "without Firebase fallback", "does not fall back to Firebase" and
      "retains Firebase access";
    - the `AUTH0_ENABLED=false` cases;
    - `env.test.ts` `AUTH0_ENABLED`.
  - Tests that created two users with one email now expect the refusal.
  - Where a test needs signup off, it passes the option.
  - "Firebase profile change" in test names and comments becomes "provider profile change".
- [ ] **Step 5: Run `pnpm --filter @wally/api test` and `pnpm --filter @wally/api typecheck`.** Expected: all pass.
- [ ] **Step 6: Run `grep -rn -i firebase apps/api/src apps/api/test`.** Expected: only
      history comments that call 6 allows (none in `plugins/` or `app.ts`).
- [ ] **Step 7: Commit:** `refactor(api)!: verify Auth0 tokens only; Firebase token verification removed`

### Task 2: `FIREBASE_PROJECT_ID` goes; the Vertex project is explicit

**Files:**

- Modify:
  - `apps/api/src/env.ts`;
  - `apps/api/src/lib/assistant/model/config.ts`, `runTurn.ts:249`, `suggest.ts:350`,
    `tidy.ts:155`;
  - `scripts/resolve-release-image.mjs`.
- Tests:
  - `apps/api/src/env.test.ts`;
  - `apps/api/src/lib/assistant/model/config.test.ts`;
  - `scripts/resolve-release-image.test.mjs`;
  - every test env object that sets `FIREBASE_PROJECT_ID`.

**Interfaces:**

- **Produces:**
  - `Env` has no `FIREBASE_PROJECT_ID` or `AUTH0_ENABLED`.
  - `ASSISTANT_VERTEX_PROJECT` is required when `ASSISTANT_ENABLED` is true.
  - `apiConfig(env)` emits `ASSISTANT_VERTEX_PROJECT: env.GCP_PROJECT_ID` in place of
    `FIREBASE_PROJECT_ID`, and no `AUTH0_ENABLED`.

- [ ] **Step 1: Write the failing tests.**
  - `env.test.ts`:
    - `requires ASSISTANT_VERTEX_PROJECT when the assistant is enabled`: `loadEnv({ DATABASE_URL, ASSISTANT_ENABLED: 'true' })` throws `/ASSISTANT_VERTEX_PROJECT/`;
    - `boots without any Firebase setting`: `loadEnv({ DATABASE_URL })` succeeds.
  - `config.test.ts`: the "falls back to the Firebase project id" case becomes
    `uses ASSISTANT_VERTEX_PROJECT as the Vertex project`.
  - `resolve-release-image.test.mjs`: the expected env names include
    `ASSISTANT_VERTEX_PROJECT` and exclude `FIREBASE_PROJECT_ID` and `AUTH0_ENABLED`.
- [ ] **Step 2: Run the three test files.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `env.ts`: drop the field, and add the check after `safeParse` in `loadEnv`, beside the
    `MCP_LOCAL_URL` check. The error is
    `ASSISTANT_VERTEX_PROJECT is required when ASSISTANT_ENABLED=true`.
  - The model functions' env `Pick`s drop `FIREBASE_PROJECT_ID`.
  - `config.ts` uses `env.ASSISTANT_VERTEX_PROJECT` and narrows with a thrown error if it is
    absent at call time.
  - Remove the env comment's fallback sentence.
  - `apiConfig`: replace the name and drop `AUTH0_ENABLED`.
- [ ] **Step 4: Run `pnpm --filter @wally/api test`, `node --test scripts/resolve-release-image.test.mjs` and the API typecheck.**
      Expected: PASS. If the script test is run another way in CI, use the `ci.yml` command.
- [ ] **Step 5: Commit:** `refactor!: Vertex project from ASSISTANT_VERTEX_PROJECT only; FIREBASE_PROJECT_ID removed`

### Task 3: The web app signs in through Auth0 only

**Files:**

- Delete:
  - `apps/web/src/features/auth/firebase.ts` and `firebase.test.ts`;
  - `SignInForm.tsx` and `SignUpForm.tsx`, with any tests of theirs;
  - the Firebase cases of `AuthProvider.test.tsx`, or the whole file if nothing else is in
    it.
- Modify:
  - `AuthProvider.tsx`, `authContext.ts`, `Auth0SessionProvider.tsx`,
    `EmailVerificationBanner.tsx` (and its test);
  - `routes/LoginPage.tsx`, `routes/SignupPage.tsx` (and `AuthEntry.test.tsx`,
    `LoginPage.test.tsx`);
  - `vite-env.d.ts`, `vitest.config.ts`;
  - `apps/web/.env.example`;
  - `apps/web/package.json` (remove `firebase`);
  - `src/i18n/en.ts` and `de.ts`: remove keys used only by the deleted code;
  - `src/lib/errors.test.ts` and `EmailVerificationBanner.tsx`: comments.

**Interfaces:**

- **Produces:**
  - `AuthContextValue = { user; status; emailVerified; signedOut; expired; signOut; refreshUser; hostedLogin: (signup: boolean, returnPath: string | null) => Promise<void>; authError?: 'migration' | 'unavailable' | null }`.
    Removed: `signInWithEmail`, `signUpWithEmail`, `signInWithGoogle`,
    `resendVerificationEmail` and `verificationSendFailed`.
  - `AuthProvider({ children })` renders `Auth0SessionProvider`.
  - `getFreshIdToken(forceRefresh = false)` returns `getAuth0AccessToken(forceRefresh)`.
  - `useAuth()` is unchanged.

- [ ] **Step 1: Update the tests first.**
  - `AuthEntry.test.tsx` and `LoginPage.test.tsx`: the login and signup routes always
    render `HostedLogin`, with no fallback form.
  - `EmailVerificationBanner.test.tsx`:
    - an unverified user sees `auth.hosted.verify` and the Confirm button;
    - a verified user with an unlocked board sees the link;
    - no Resend button is ever rendered.
  - Remove fakes' Firebase-only members.
- [ ] **Step 2: Run `pnpm --filter @wally/web test`.** Expected: FAIL (types and the old branches).
- [ ] **Step 3: Implement.**
  - Delete the Firebase files, `FirebaseAuthProvider` and `verificationSettings`.
  - Narrow the context, and stop setting the removed members in `Auth0SessionProvider`.
  - The pages render `<HostedLogin />` and `<HostedLogin signup />`.
  - The banner keeps its hosted-unverified and unlocked branches. Its resend state, cooldown
    and `friendlyResendError` go.
  - Remove the `VITE_FIREBASE_*` and `VITE_AUTH_PROVIDER` declarations and vitest defines.
    Keep any `VITE_AUTH0_CLIENT_ID` define that tests need.
  - `.env.example` lists `VITE_API_BASE_URL` and `VITE_AUTH0_CLIENT_ID` only, with a line
    that the client id is public.
  - `pnpm --filter @wally/web remove firebase`.
  - Delete the i18n keys that `grep` shows unused in both catalogues (the parity test must
    pass).
- [ ] **Step 4: Run `pnpm --filter @wally/web test`, `typecheck`, `lint` and `build`.** Expected: PASS. Then run
      `grep -rn -i firebase apps/web/src`. Expected: no hits.
- [ ] **Step 5: Commit:** `refactor(web)!: Auth0 is the only sign-in; Firebase sign-in UI removed`

### Task 4: Compose, CI, release, E2E support and repo config

**Files:**

- Delete: `.firebaserc`.
- Modify:
  - `docker-compose.yml`, `docker-compose.mcp-local.yml`, `.env.example`;
  - `.github/workflows/ci.yml`, `.github/workflows/release.yml`;
  - `.github/CODEOWNERS`, `.github/actions/setup/action.yml` (comment only);
  - `scripts/bootstrap-gcp-cicd.sh`;
  - `apps/web/e2e/support.ts`, `apps/web/playwright.config.ts` (comments).

**Required content:**

- **`docker-compose.yml`:**
  - The api service has no `FIREBASE_PROJECT_ID`.
  - The web service has no `VITE_AUTH_PROVIDER`, and sets
    `VITE_AUTH0_CLIENT_ID: ${VITE_AUTH0_CLIENT_ID:?Set VITE_AUTH0_CLIENT_ID in .env (the public Auth0 SPA client id; see .env.example)}`.
  - The Firebase comment lines go.
- **`docker-compose.mcp-local.yml`:**
  - drop `FIREBASE_PROJECT_ID` from both services;
  - drop `AUTH0_ENABLED` wherever it is set;
  - check whether the MCP stack's web service needs `VITE_AUTH0_CLIENT_ID`, and give it a
    placeholder only if it serves no sign-in.
- **`.env.example`:**
  - no Firebase block, `AUTH0_ENABLED` or `VITE_AUTH_PROVIDER`;
  - `AUTH0_SIGNUP_ENABLED=true` with a comment that this is local only;
  - `VITE_AUTH0_CLIENT_ID=` with a comment that it is the public SPA client id;
  - `ASSISTANT_VERTEX_PROJECT=` with a comment that it is required when the assistant is
    on.
- **`ci.yml`:**
  - The unit-test job's `FIREBASE_PROJECT_ID` and its comment go.
  - In the E2E job:
    - the provider expression and the `E2E_AUTH_PROVIDER` env go;
    - the `.env` step always writes the Auth0 file without `FIREBASE_PROJECT_ID` and
      `AUTH0_ENABLED`;
    - the HTTPS preparation, routing checks and identity binding steps lose their `if:`;
    - Playwright gets `E2E_USER_EMAIL` and `E2E_USER_PASSWORD` straight from the Auth0
      variable and secret, keeping the Dependabot selection expression.
  - Remove the `labeled`/`unlabeled` pull request triggers if they exist only for
    `auth0-validation`.
  - Fold `docker-compose.auth0-ci.yml` into the `COMPOSE_FILE` value set at job level, and
    keep the file.
- **`release.yml`:**
  - no `VITE_AUTH_PROVIDER` or `AUTH0_ENABLED` env;
  - the validation step checks `AUTH0_SIGNUP_ENABLED`, `MCP_*` and `ASSISTANT_ENABLED`
    booleans, requires a non-empty `VITE_AUTH0_CLIENT_ID`, and keeps the MCP rules without
    the `AUTH0_ENABLED` clause;
  - the migrations `docker run` loses `-e FIREBASE_PROJECT_ID=…`;
  - the web build step has no `VITE_FIREBASE_*` and checks `VITE_API_BASE_URL` and
    `VITE_AUTH0_CLIENT_ID`.
- **`support.ts`:** no provider switch. `completeSignIn` is the Auth0 branch only.
- **`playwright.config.ts`:** the comments say Auth0 instead of "Firebase Auth round trip"
  and "Firebase ID tokens".
- **`bootstrap-gcp-cicd.sh`:**
  - drop `firebase.googleapis.com` from the enabled APIs;
  - drop the Firebase `gh variable set` lines, the Firebase CI account secret lines and
    `E2E_AUTH_PROVIDER`;
  - list the Auth0 E2E variables and secret instead, with names exactly as in `ci.yml`.
- **`CODEOWNERS`:** drop the two firestore lines.
- **`action.yml` comment:** drop "and the Firebase CLI".

- [ ] **Step 1: Make the edits above.**
- [ ] **Step 2: Check the compose files.**
  - `docker compose --env-file .env.example config >/dev/null` with `VITE_AUTH0_CLIENT_ID=x` exported. Expected: success.
  - Then without it. Expected: an error naming `VITE_AUTH0_CLIENT_ID` (Review Focus 5).
  - `docker compose -f docker-compose.mcp-local.yml config >/dev/null`. Expected: success.
- [ ] **Step 3: Check the workflows.**
  - `npx --yes @action-validator/cli@0.6.0 .github/workflows/ci.yml`, and the same for
    `release.yml`, or `actionlint` if installed. Expected: no errors.
  - `bash -n scripts/bootstrap-gcp-cicd.sh`. Expected: no output.
- [ ] **Step 4: Run `grep -rn -i -E 'firebase|firestore' .github scripts docker-compose*.yml .env.example apps/web/e2e/*.ts apps/web/playwright.config.ts`.** Expected: no hits.
- [ ] **Step 5: Commit:** `ci!: E2E and the release use Auth0 only; Firebase settings removed from compose, CI and scripts`

### Task 5: Shared schemas and the comment sweep

**Files:**

- Modify:
  - `packages/shared/src/schemas/assistant.ts:99,107`, `packages/shared/src/schemas/tidy.ts:12,24,74`;
  - comments in `packages/shared/src/schemas/customField.ts`, `me.ts`, `enums.ts`;
  - comments in `apps/web/src/features/board/ListView/NoteRow.tsx:106`,
    `NoteDetail/CustomFieldEditor.tsx:30`, `apps/web/src/i18n/de.ts:1069`;
  - comments in `apps/api/vitest.config.ts:10`, `apps/api/test/postgres.ts:25`,
    `apps/api/test/notes.test.ts:217,366`;
  - comments in `apps/api/src/lib/members.ts:17`, `apps/api/src/lib/members.test.ts:135,268`,
    `apps/api/test/invite-security.test.ts:8`.

**Rules (call 6):**

- Rename the local constant `firestoreId` to `recordId`. The regex and messages are
  unchanged.
- A comment that states Firestore or Firebase as the current store, provider or file is
  rewritten to the present truth. Examples:
  - "Firestore returns map keys in its own order" becomes JSON object order;
  - the `firestore.indexes.json` exemption advice is removed;
  - "Firebase permits sign-up with an address you do not control" becomes "the sign-in
    provider permits…".
- A comment that explains a shape by its Firestore origin stays. Examples: ids shaped like
  Firestore auto-ids, the TTL job comment, and `transaction.ts`'s comparison with Firestore
  transactions.

- [ ] **Step 1: Make the edits.**
- [ ] **Step 2: Run `pnpm turbo run test typecheck lint --filter @wally/shared --filter @wally/web --filter @wally/api`.** Expected: PASS.
- [ ] **Step 3: Run `grep -rn -i -E 'firebase|firestore' apps packages --include=*.ts --include=*.tsx`.** Expected: only historical-origin comments. List them in the PR body.
- [ ] **Step 4: Commit:** `refactor: neutral record-id name and comments no longer describing Firebase as current`

### Task 6: In-app privacy text (call 7)

**Files:** `apps/web/src/i18n/en.ts:22`, `apps/web/src/i18n/de.ts:28`, and any test that
snapshots it.

**Required meaning:** the processors match `docs/GDPR.md`'s processor row after Task 7:

- Auth0 (Okta) handles login, signup and recovery.
- Google provides the API hosting and the built-in assistant's model (Vertex AI).
- Supabase stores the data.
- Cloudflare serves the web app and forwards API traffic.
- If you use Google sign-in, Google also authenticates you.
- The rest of the paragraph (assistant, connected providers, disconnect) is unchanged.

- [ ] **Step 1: Edit the English text. Write the German text in the catalogue's existing register (informal "du").**
- [ ] **Step 2: Run `pnpm --filter @wally/web test`.** Expected: PASS, including catalogue parity.
- [ ] **Step 3: Commit:** `fix(web): privacy text names the current processors`

### Task 7: Docs

Follow the spec's "Docs (same PR)" list exactly. Specifics the spec leaves to this plan:

- **`docs/DEPLOY.md`:**
  - **§3** becomes "Put the project on billing". Link Google's
    [enable billing](https://cloud.google.com/billing/docs/how-to/modify-project) page.
  - **§6** keeps only the `gcloud config set project` part. `firebase use --add` and
    `.firebaserc` go.
  - **§11** is removed and the later sections are renumbered, with internal anchors fixed.
  - **The "Firebase retired" section** (replacing "Firestore after the switch") has:
    - a table of resource, action, date run and verified, filled with "pending" now and
      completed after groups A–C;
    - the two things that stay: the disabled default Hosting site, and the irreversible
      Firebase attachment, quoting Google's sentence with its link.
  - **The rollback warning:** "Do not roll back past v0.12.0" stays.
- **`docs/AUTH0.md`:**
  - Configuration: no `AUTH0_ENABLED` or `VITE_AUTH_PROVIDER`. Local runs need
    `VITE_AUTH0_CLIENT_ID`, and `AUTH0_SIGNUP_ENABLED=true`.
  - Note the login confirmation on `localhost` after a reload, with the Auth0 consent link
    from the spec.
  - Previews on another port need that port registered in the SPA client first.
- **`apps/web/e2e/README.md`:** Auth0 is the only mode, and local runs are CI-only (call 3).
  The README's existing Auth0 section becomes the whole procedure.
- **`docs/GDPR.md`:**
  - The processor row drops Firestore and Firebase Auth.
  - The data-location lines drop the Firestore database.
  - The sign-in section: Auth0 everywhere.
  - The erasure lines: Firebase Auth goes.
  - The `firestore.rules` sentence goes, or becomes history.
- **ADR index:**
  - ADR-0003: "no longer in effect since v0.12.0 … the Firestore database was deleted on
    <date>". Fill in the date after group A, or write "deletion pending" and fix it after.
  - ADR-0004: "no longer in effect for Firebase tokens since <next release>".
  - ADR-0008: the Hosting mention.
  - ADR-0009: the cell, plus the status line in both the index and the ADR file (call 5).
  - "Last checked" is set to this branch's base commit.
- **RFC index and RFC-0011:**
  - §4 status: workstream 6 is merged, not released.
  - §6: the Firebase bullets are marked done or pending, with the owner's 2026-11-01
    decision to retire Firebase Authentication now.
  - §3 stays history.
- **`docs/SETUP.md`, `README.md`, `docs/architecture/overview.md`, `docs/README.md`,
  `docs/SPEC.md`:** every sentence presenting Firebase as current is corrected.

- [ ] **Step 1: Make the edits.**
- [ ] **Step 2: Run `pnpm run format:check`.** Expected: PASS. Run `grep -rn -i -E 'firebase|firestore' docs/*.md docs/adr/README.md docs/rfcs/README.md docs/architecture apps/web/e2e/README.md README.md`
      and read every remaining hit. Each must be history, or the retirement record.
- [ ] **Step 3: Check that every relative link and anchor in the changed docs resolves.** Use a small script: grep for `](`, resolve the paths, and check the
      `#anchors` against the target headings. Expected: none broken.
- [ ] **Step 4: Commit:** `docs: Firebase retired — DEPLOY, AUTH0, GDPR, SETUP, indexes and RFC-0011`

### Task 8: Verify, review, PR

- [ ] **Step 1: Run `pnpm turbo run lint typecheck build test` with `DATABASE_URL` set, and `pnpm run format:check`.** Expected: all PASS.
- [ ] **Step 2: Run `git grep -n -i -E 'firebase|firestore' -- . ':!docs/superpowers' ':!docs/researches' ':!docs/rfcs/RFC-000*' ':!docs/adr/ADR-00*' ':!pnpm-lock.yaml'`.** Read every hit; each must be justified (history or the retirement record). Then run `grep -c firebase pnpm-lock.yaml`. Expected: 0.
- [ ] **Step 3: Whole-branch review.** One fresh reviewer agent on the most capable model
      gets the spec, this plan and `git diff origin/main...HEAD`. Fix every finding of
      correctness or completeness, including small ones, rather than handing them to the owner.
- [ ] **Step 4: Push and open the PR.**
  - **Before pushing,** run `gh auth status` and confirm the active account is
    `milad-luminull`.
  - **Push:** `git push -u origin chore/retire-firebase`.
  - **Title:** `refactor!: retire Firebase — Auth0 is the only sign-in; Firestore and Hosting leftovers removed (workstream 6, part 1)`.
  - **The body lists:**
    - what changed, by area;
    - the calls from the spec;
    - the owner-run groups A–C, linked to the spec section;
    - Review Focus 3's observed behaviour;
    - that the Dependabot identity is proven by the first bot PR after merge.
  - **Footer:** `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- [ ] **Step 5: Bind the PR with the ccd_pr tools and read CI.** The E2E job must run in
      Auth0 mode and pass the vacuous-green guard. Do not call the PR ready before CI is green.
