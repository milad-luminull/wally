# E2E specs

These assume the **full stack** is running (`make up` at the repo root: `api` + `web` +
`firestore`, seeded via `make seed`) — they are not runnable standalone against `apps/web`
in isolation, since sign-in goes through real Firebase Authentication and every board
action round-trips through the real API and the Firestore emulator.

Before running `pnpm --filter @wally/web test:e2e`:

1. `make up && make seed` from the repo root.
2. Create (or confirm) a Firebase test user and export its credentials:
   ```
   export E2E_USER_EMAIL=mika.brandt@example.com
   export E2E_USER_PASSWORD=<the seeded test account's password>
   ```
   (the seed script's demo owner — see `apps/api/src/seed.ts` — but Firebase Auth accounts
   aren't seedable from the app's own data, so this account has to exist in the project's
   Firebase Auth separately; that's a one-time manual/CLI step, not part of `make seed`.)
3. Optionally set `PLAYWRIGHT_BASE_URL` if `apps/web` isn't on the default
   `http://localhost:5173`.

Each spec is a single happy path per SETUP.md's "one happy-path test per main user flow.
No more." — they intentionally don't chase edge cases; that's what the Vitest suites are for.

`boards.spec.ts` creates a board named `E2E <timestamp>` on the test account and deletes it
again; an `afterEach` removes any `E2E …` board a failed run left behind, because a second
board makes sign-in land on the board home instead of the board.

Do not rename the test account's first board. It must stay "Meine Wand": when sign-in lands on
the board home, `signIn()` in `support.ts` opens the board by that name, and every spec
works on it.

The test account's UI is German, so the specs find controls by their German labels; the test
data they create (note titles, subtasks) is English.

## Auth0 mode (opt-in, cutover validation pending)

Set `E2E_AUTH_PROVIDER=auth0` for Playwright and `VITE_AUTH_PROVIDER=auth0` for the
web container. The API must use `AUTH0_ENABLED=true`, `AUTH0_SIGNUP_ENABLED=false`,
`FIREBASE_PROJECT_ID=wally-e2e` and the Firestore emulator. Tokens still pass the real
Auth0 signature, issuer and REST audience checks. No test authentication endpoint or
password grant is added.

Use a dedicated Auth0 database test account. An administrator may set its password
without an inbox; never treat that as proof of password-reset email delivery. Supply
its exact Auth0 subject as `E2E_AUTH0_SUBJECT` and email as `E2E_AUTH0_EMAIL`, then run
the normal seed followed by:

```sh
docker compose exec -T -e E2E_AUTH0_SUBJECT -e E2E_AUTH0_EMAIL api \
  pnpm --filter @wally/api exec tsx src/seed-auth0-e2e.ts
```

This binds the identity to `seed-owner` in the emulator only. It refuses other projects,
missing emulator configuration and Google subjects. It never creates or updates an
Auth0 account. `E2E_USER_EMAIL` and `E2E_USER_PASSWORD` feed the actual hosted login
form; the helper checks the expected login origin before entering credentials.
Browser traces and video are disabled, including local runs.

For GitHub CI, keep the existing Firebase secrets as rollback credentials. Add repository
variables `VITE_AUTH0_CLIENT_ID`, `E2E_AUTH0_SUBJECT`, `E2E_AUTH0_EMAIL` and a separate
secret `E2E_AUTH0_USER_PASSWORD`. Only set repository variable
`E2E_AUTH_PROVIDER=auth0` after validation; until then CI keeps its Firebase path.
For a controlled pre-cutover run, a maintainer can apply the `auth0-validation` label
to a same-repository pull request. That PR then uses Auth0 while the repository
default stays Firebase. Removing the label restores that PR's default mode.
Do not apply the label until both applicable test identities and secret stores are ready.
Missing Auth0 credentials fail the job and never fall back to the Firebase password.
Dependabot runs use a separate test identity: repository variables
`E2E_AUTH0_DEPENDABOT_EMAIL` and `E2E_AUTH0_DEPENDABOT_SUBJECT`, plus the same secret name
`E2E_AUTH0_USER_PASSWORD` in the **Dependabot** secret store, containing that account's
password. Missing bot configuration never falls back to the regular CI account.
The owner uses the `+1` dummy account for ordinary CI and `+2` for Dependabot.
Both are mapped only into the ephemeral emulator when tests run; the bot does not
need a production Wally identity mapping.

Localhost currently returns to login after silent session restoration times out.
Interactive login succeeds, but reload-dependent tests remain a cutover blocker.
Do not relax consent, persist tokens in local storage, skip these tests, or count
the Firebase-mode CI run as Auth0 validation.
