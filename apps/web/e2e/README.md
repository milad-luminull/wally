# E2E specs

These run against the **full stack** (`postgres`, the one-shot `migrate`, `api` and `web`,
seeded with the demo data) — they are not runnable standalone against `apps/web` in
isolation, since sign-in goes through a real identity provider, Auth0's hosted login page,
and every board action round-trips through the real API and the stack's own PostgreSQL.

**The suite runs in CI only.** On a plain `http://localhost` origin, Auth0 asks for an
interactive login confirmation after every page reload
([AUTH0.md](../../../docs/AUTH0.md#configuration)), which the specs cannot pass. CI avoids
it by serving the production hostnames over HTTPS inside its disposable runner (below);
doing the same on a laptop would point those hostnames away from production for everything
on that machine, so do not. CI is the proof that E2E passes.

Each spec is a single happy path per SETUP.md's "one happy-path test per main user flow.
No more." — they intentionally don't chase edge cases; that's what the Vitest suites are for.

`boards.spec.ts` creates a board named `E2E <timestamp>` on the test account and deletes it
again; an `afterEach` removes any `E2E …` board a failed run left behind, because a second
board makes sign-in land on the board home instead of the board.

`account-delete.spec.ts` deletes the test account's Wally data. It runs in its own
Playwright project, `account-deletion`, which depends on the other two and so starts only
after they have passed. CI's database is new for every run, so the next run's seed creates
the account again, and CI has no Auth0 Management secret, so the Auth0 test user is never
deleted.

Do not rename the test account's first board. It must stay "Meine Wand": when sign-in lands on
the board home, `signIn()` in `support.ts` opens the board by that name, and every spec
works on it.

The test account's UI is German, so the specs find controls by their German labels; the test
data they create (note titles, subtasks) is English.

## How CI signs in

The API runs with `AUTH0_SIGNUP_ENABLED=false` against the stack's local PostgreSQL.
Tokens pass the real Auth0 signature, issuer and REST audience checks. No test
authentication endpoint or password grant exists.

CI uses a dedicated Auth0 database test account. An administrator may set its password
without an inbox; never treat that as proof of password-reset email delivery. After the
normal seed, CI binds the account's exact Auth0 subject (`E2E_AUTH0_SUBJECT`) and email
(`E2E_AUTH0_EMAIL`) to the demo owner:

```sh
docker compose exec -T -e E2E_AUTH0_SUBJECT -e E2E_AUTH0_EMAIL api \
  pnpm --filter @wally/api exec tsx src/seed-auth0-e2e.ts
```

This binds the identity to `seed-owner` in the local database only. It refuses any
`DATABASE_URL` whose host is not `localhost`, `127.0.0.1`, `[::1]` or the compose service
`postgres`, any `NODE_ENV=production`, and any subject that is not an Auth0 database
subject (`auth0|…`). It never creates or updates an Auth0 account. `E2E_USER_EMAIL` and
`E2E_USER_PASSWORD` feed the hosted login form; the helper checks the expected login origin
before entering credentials. Browser traces and video are disabled.

**GitHub configuration:**

- Repository variables `VITE_AUTH0_CLIENT_ID`, `E2E_AUTH0_SUBJECT` and `E2E_AUTH0_EMAIL`,
  and the secret `E2E_AUTH0_USER_PASSWORD`. Missing credentials fail the job.
- Dependabot runs use a separate test identity: repository variables
  `E2E_AUTH0_DEPENDABOT_EMAIL` and `E2E_AUTH0_DEPENDABOT_SUBJECT`, plus the same secret
  name `E2E_AUTH0_USER_PASSWORD` in the **Dependabot** secret store, containing that
  account's password. Missing bot configuration never falls back to the regular CI account.
- The owner uses the `+1` dummy account for ordinary CI and `+2` for Dependabot. Both are
  mapped only into the runner's disposable database when tests run; neither needs a
  production Wally identity mapping.

**The HTTPS setup:** the Auth0 CI override (`docker-compose.auth0-ci.yml`) serves the
existing app and API hostnames over HTTPS, mapped to loopback only inside the disposable
runner. An ephemeral CA is trusted in that runner and its browser certificate store; normal
TLS validation remains enabled. The proxy forwards only to the local web and API
containers, and DNS and socket checks must pass before Playwright starts. Public DNS,
production services and Auth0 callbacks are unchanged. The setup lets the session restore
on a reload while tokens stay in memory only. Do not relax consent, persist tokens in local
storage, or skip these tests.
