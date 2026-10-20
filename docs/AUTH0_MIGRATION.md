# Controlled Firebase → Auth0 migration

The migration CLI is implemented. On 2026-10-19, the owner-approved single password
account import completed in Auth0: one inserted, zero updated, zero failed. Upsert and
completion emails were disabled. The job result is recorded in the private operator
migration directory. On 2026-10-20, after explicit owner approval and a fresh CLI
verification, the one password identity was bound in production database `wally`.
Readback confirmed the original Wally user ID. The owner's Google identity was also
verified and mapped on 2026-10-20 after explicit approval, fresh source/Auth0 checks
and production readback. Four Google subjects remain unmapped.
The temporary verifier grant was revoked and its local
credential copies removed after the operation.
Real Google sign-in and logout passed against an isolated emulator fixture. HTTPS
session restoration, password recovery and rollback still need cutover validation.
The owner identified both legacy password accounts as CI fixtures without inboxes;
do not send reset emails to them. Administrator password setup for a test account
does not validate email delivery or password recovery. Keep Firebase login available.

## Trust boundary

`apps/api/src/auth-migrate.ts` reads Firebase Admin `listUsers` metadata and existing
Wally user document IDs. It never exports password hashes, salts, refresh tokens or
credentials. Use a source-reader credential without password-hash access. Export files
contain personal data; keep them outside the repository in a protected mounted directory.
Files are created with mode 0600 in a new 0700 directory and are never overwritten.

The stable Wally ID remains the original Firebase UID. Database import IDs are a
deterministic SHA-256 of `[Firebase project, Firebase UID]` with a `wally-firebase-`
prefix. Private Auth0 app metadata records that same source project and UID. Neither
email matching nor user-editable metadata authorizes a mapping. Google uses the exact
Firebase `google.com` provider UID as Auth0's `google-oauth2|<provider UID>` subject.
Both methods on one Firebase user produce two mappings to the same Wally ID.

Disabled users, missing Wally records, unsupported providers, invalid emails, duplicate
emails (case-insensitive), duplicate Firebase UIDs and ambiguous Google subjects are
quarantined in `plan.json` with reasons. Quarantined users are excluded from import and
mapping. They need a separately reviewed recovery decision; never resolve them by
email-only linking or by creating a replacement empty Wally account.

## Export and review

Run in the existing API container with Firebase credentials/project configured through
the established secure deployment mechanism. `--project` must match the initialized
Firebase project. Paths below are container paths; mount a protected directory if the
exports must survive container replacement. Replace `SOURCE_PROJECT` and
`Wally-Database` with the intended project and Auth0 database connection **name**.
For production Wally, explicitly select `FIRESTORE_DATABASE_ID=wally` and unset
`FIRESTORE_EMULATOR_HOST` and `FIREBASE_AUTH_EMULATOR_HOST` in the migration subprocess.
The development container's default database configuration is not the production
target. Apply this same environment to export, verification and mapping operations.

```sh
docker compose exec -T -e ASSISTANT_ENABLED=false -w /app api \
  pnpm --filter @wally/api exec tsx src/auth-migrate.ts export \
  --project SOURCE_PROJECT --connection Wally-Database \
  --output /tmp/wally-auth0-review
```

This is read-only for Firebase/Auth0. It creates `plan.json` and `users-0001.json`, etc.
The JSON import chunks stay below 450,000 bytes. Review issues and intended subjects.
For a controlled batch, append `--uids FIREBASE_UID_1,FIREBASE_UID_2` to **both** export
and verification commands. Global ambiguity checks still run before selection.
Use a fresh output directory for each export. Unknown selected UIDs fail closed.

## Import in Auth0, as a separate controlled operation

Upload only `users-*.json` to the intended database connection using the Auth0 Dashboard
or an approved import job workflow. Do not upload `plan.json`. Disable upsert and
completion emails. Save job IDs, totals and per-record errors in the operator's secure
migration record. An existing-email conflict requires investigation; never enable upsert
to make it disappear. Auth0 prefixes the supplied IDs with `auth0|`; the export therefore
omits that prefix. Auth0 limits uploads to 500 KB and concurrent import jobs to two.
See [Auth0 bulk import](https://auth0.com/docs/manage-users/user-migration/bulk-user-imports)
and the [JSON schema](https://auth0.com/docs/manage-users/user-migration/bulk-user-import-schema).

The export deliberately includes no password or password hash. Auth0 generates an
unknown random password hash, so imported users must reset their password before
password login. `wally_password_reset_required` documents the import policy; it is not
an Auth0 enforcement toggle. The CLI never sends reset emails or sets passwords.
See [Auth0's password-free import behavior](https://support.auth0.com/center/s/article/auth0-bulk-user-import-without-password-hashes).

Google accounts are not database imports. They must exist in Auth0 after a controlled
Google login before verification can succeed. A first login may correctly show migration
required until the operator binds the verified identity. No email-based auto-linking is
used. Select ready users with `--uids` so an unavailable Google account does not block
an unrelated batch. Users with both providers must have both Auth0 subjects ready.

## Verify and explicitly apply

Provision a short-lived Management API token with `read:users` as
`AUTH0_MIGRATION_TOKEN` in the operator environment; never put it in arguments or files.
The reader calls only `https://login.luminull.com/api/v2/users/<exact subject>` and
refuses redirects. Obtain this token through `login.luminull.com` using the canonical
tenant Management API audience, not the Wally REST audience or a custom-domain audience.
[Auth0 requires token issuance and API calls to use the same domain](https://auth0.com/docs/customize/custom-domains/configure-features-to-use-custom-domains).

```sh
docker compose exec -T -e ASSISTANT_ENABLED=false -e AUTH0_MIGRATION_TOKEN -w /app api \
  pnpm --filter @wally/api exec tsx src/auth-migrate.ts verify \
  --project SOURCE_PROJECT --connection Wally-Database \
  --plan /tmp/wally-auth0-review/plan.json
```

Verification re-reads trusted Firebase metadata and Wally IDs, reconstructs the entire
selected plan, and rejects any difference from the reviewed file. It then verifies all
Auth0 accounts before any mapping write. Database accounts need matching primary
subject, provider identity, connection and private source markers. Google accounts need
matching primary subject, Google provider UID and connection. Blocked Auth0 accounts,
missing accounts, network/rate-limit errors or evidence mismatches abort the batch
without mappings. No email claim is sufficient evidence.

Only after that dry run and an operator review, append both flags to the same command:

```text
--apply --confirm-project SOURCE_PROJECT
```

Apply uses `bindImportedIdentity` transactions. Exact retries are idempotent; an existing
mapping cannot be reassigned and a deleted Wally user cannot be recreated. Results list
`verified` (dry run), `bound`, or `failed` for every selected subject. A mapping failure
returns a nonzero exit status but preserves successful mappings. Resolve the failure and
repeat the same command: the database mappings are the resume journal, so interrupted
runs are safe to repeat even if the final output was lost. Mapping writes are individually
atomic, not one transaction for the whole batch. Source snapshots can change during a
run; use a controlled migration window and stop account deletion/provider changes while
applying. Re-export and review if source metadata has changed.

## Required cutover checks

On controlled test accounts, verify an imported password user cannot use the old Firebase
password in Auth0, can request and complete Auth0 password reset, and then sees the same
Wally ID, boards, memberships and preferences. Verify reset delivery, expired/used links,
wrong-email attempts and account recovery. Verify Google login resolves the exact source
provider subject and original Wally data. An unlinked or same-email different subject
must not gain access or create an empty account. Verify unverified-email invite rules.

Keep Firebase rollback available while checking all affected users. Disabling Auth0 in
the application preserves existing Firebase login and mapping records. Do not delete
source accounts or mappings to undo a partial import. Retiring Firebase, production
imports, sending recovery emails and real-tenant validation are separate release actions;
this command has performed none of them.

## Automated verification

```sh
docker compose exec -T -e ASSISTANT_ENABLED=false -w /app api \
  pnpm --filter @wally/api test src/lib/auth/migration.test.ts \
  src/lib/auth/migration-cli.test.ts src/lib/auth/migration.integration.test.ts
```

The unit tests cover credential exclusion, deterministic imports, quarantine, subject
continuity, tampered plans, apply gates, chunking and preflight. Firestore emulator tests
cover stable IDs, preserved data, retries, mapping conflicts and deleted users. Real
Auth0 import and recovery have not been validated by these tests.
