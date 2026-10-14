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
