# Auth0 API activation and migration

Auth0 web login and MCP are opt-in. The default configuration keeps Firebase web login
and disables Auth0 API tokens, MCP, and MCP writes. Configuration support does not imply
production activation. See [the rollout](rfcs/AUTH0_MCP_ROLLOUT.md) for delivery gates.

## Configuration

The root `.env` feeds Docker Compose. Keep these safe defaults until migration and tenant
checks are complete:

```dotenv
AUTH0_ENABLED=false
MCP_ENABLED=false
MCP_WRITES_ENABLED=false
VITE_AUTH_PROVIDER=firebase
```

For a coordinated Auth0 test, set `AUTH0_ENABLED=true`, `VITE_AUTH_PROVIDER=auth0`, and
`VITE_AUTH0_CLIENT_ID` to the public Auth0 SPA client ID. Docker keeps the local API at
`http://localhost:4000` and browser origin at `http://localhost:5174`; issuer and token
audience remain the production identifiers below. Register `http://localhost:5174/login`
and `https://wally.luminull.com/login` as allowed callbacks in the intended SPA client;
register the corresponding origins for web origins and logout URLs. The SPA requests
`openid profile email offline_access`, uses memory token storage and refresh tokens;
configure refresh-token rotation and test login, callback, renewal and logout in that tenant.
Never put a client secret in a `VITE_*` variable.

MCP activation additionally requires `MCP_ENABLED=true`, `ASSISTANT_ENABLED=true` and `MCP_CLIENT_ID` for the
approved MCP client. Keep `MCP_WRITES_ENABLED=false` until the write rollout gates pass.
Leave `MCP_CLIENT_ID` absent when unused, rather than setting an empty value. Docker
inherits this optional value from `.env` without injecting a blank default. Recreate the
containers after changing `.env`.

Releases use repository variables with the same names. The workflow rejects unknown
providers, invalid booleans, Auth0 web login without API Auth0 or a SPA client ID, MCP
without API Auth0, the assistant switch or its client ID, and writes without MCP. Unset switches default off;
the web provider defaults to Firebase. Issuer and audience are pinned rather than supplied
by repository variables. See [deployment configuration](DEPLOY.md#configuration).

## API contract

Set `AUTH0_ENABLED=true` only for a deployment where imported identities and access-token
claims are ready. The issuer is exactly `https://login.luminull.com/`; the REST audience
is exactly `https://api.wally.luminull.com`, with RS256 signing. No client secret is
needed by the API. Firebase remains available for rollback until the cutover is verified.

In Auth0, register the REST API with that audience. Add the versioned
[Post Login Action](../infra/auth0-post-login.cjs) to its login flow. It supplies the
signed email, email-verification and name claims only for the REST and MCP audiences.

The Action was deployed and attached to the tenant's Post Login flow on 2026-10-19.
Production Wally login cutover remains pending. Request access tokens for
the REST audience; SPA ID tokens and MCP-audience tokens are rejected. Missing profile
claims fail closed. Auth0 signs the claims; the frontend cannot supply a trusted email
or verification flag. Current board authorization still runs in Wally.

## Stable account IDs

`authIdentities/{sha256(JSON.stringify([issuer, subject]))}` maps the verified external
identity to an existing Wally user ID. Its fields are `issuer`, `subject`, `userId`, and
`createdAt`. No credential or email is stored. It is private server data under the existing
deny-all client database rules.

`bindImportedIdentity` in [identities.ts](../apps/api/src/lib/auth/identities.ts) is the
trusted migration boundary: it checks the target exists, creates the mapping atomically,
allows exact retries and refuses reassignment. It has no HTTP route. Import tooling must
supply the subject returned by Auth0 for the exact imported source record, using the
source Firebase UID as Wally user ID. Never discover an owner by email matching.

With the signup gate off, unmapped Auth0 tokens return `403 IDENTITY_NOT_LINKED`; no account or board is created.
Mappings whose Wally user was deleted also fail closed. The hosted web login and controlled migration runner are implemented; production import,
recovery and rollback checks remain required before cutover. See [the migration runbook](AUTH0_MIGRATION.md).

The owner chose mandatory Auth0 password reset for existing email/password users.
The import must preserve their Wally IDs, require verified recovery through Auth0 and
provide a tested recovery path before Firebase is retired. Google identities need
verified provider-subject continuity or proof of the old and new identities. Neither
procedure has been executed against production.

## Verification and rollback

Run API tests in Docker with `ASSISTANT_ENABLED=false`, matching CI; local development may
have the assistant enabled. Signed-token tests exercise real JWT verification, and emulator
tests exercise stable IDs, same-email rejection, conflicting/concurrent imports and deleted
accounts. Real-tenant sign-in and the served frontend are separate cutover checks.

Set `AUTH0_ENABLED=false` to disable Auth0 tokens without removing identity mappings or
changing existing Firebase login. Do not remove the Firebase verifier until rollback and
account recovery are verified. Production web builds must use `https://api.wally.luminull.com`;
the release checks the custom-domain mapping and canonical CORS origin before and after
deployment. To roll the browser back too, rebuild with `VITE_AUTH_PROVIDER=firebase` and
deploy the matching bundle. Set `MCP_ENABLED=false` and `MCP_WRITES_ENABLED=false` when
disabling Auth0. Existing identity mappings remain intact.

## New-account signup gate

`AUTH0_SIGNUP_ENABLED` defaults to `false`, separately from token verification. Keep it
false while importing existing users. When deliberately enabled after migration review,
an unmapped verified Auth0 token may create a random stable Wally user ID, its initial
board and identity mapping in one transaction. A normalized email collision with any
existing Wally user denies signup with `IDENTITY_NOT_LINKED`; it never links accounts or
selects an existing owner by email. Concurrent signups are checked transactionally.
Mapped identities remain immutable, and deleted mapped users are never recreated.
Unverified email stays unverified and cannot activate board invites.

Existing user emails follow the application's lowercase/trimmed storage contract. Audit
any manually written legacy records against that contract before enabling signup. Keep
Firebase rollback available, and finish import/recovery first: a Firebase user who changes
their email before import can otherwise look like a new Auth0 account. Email collision
checks prevent accidental duplicates for matching stored addresses; they cannot prove
that a completely different address belongs to an unmigrated user. Existing-email
collisions need controlled recovery, including unverified-email squatters; this gate
never repairs or merges them automatically.

The flag is carried through Docker Compose and release configuration, but remains off
unless explicitly set. No deployment or production onboarding occurred in this change.

## MCP setup and verification

The MCP API identifier is `https://api.wally.luminull.com/mcp`, separate from REST.
It uses RS256 and `wally:read`/`wally:write`. Keep per-app authorization, disable
machine-to-machine access, require user consent, and enable Resource Parameter
Compatibility Profile so OAuth `resource` selects this audience. API access tokens
are configured for 900 seconds; rotating refresh tokens have a seven-day inactivity
limit and a 30-day maximum.

Use a predefined public ChatGPT OAuth client with Authorization Code + S256 PKCE for
the Free-tier rollout. Do not rely on the trial's imported ChatGPT CIMD client:
Auth0 currently maps its `private_key_jwt` preference, and
[Auth0 documents that method as Enterprise-only](https://auth0.com/docs/get-started/auth0-overview/create-applications/register-applications-with-cimd).
The unused imported client's MCP grant was revoked. Dynamic registration and CIMD
discovery remain disabled. Copy the actual callback from the host setup; the issuer
currently advertises RFC 9207, for which ChatGPT documents
`https://chatgpt.com/connector_platform_oauth_redirect`.

The replacement third-party client `Wally ChatGPT (PKCE)` has client ID
`tpc_oR2NUn5BAcms9r5Z5MhHVf`. Its MCP user-delegated read/write grant was approved
and saved on 2026-10-19, with Authorization Code and rotating Refresh Token grants.
Real-host login and token verification remain pending.

With owner approval, `google-oauth2` and `Username-Password-Authentication` were
promoted to domain-level connections and verified enabled for this client. These
providers are consequently available to all tenant third-party applications;
API grants and Wally board authorization remain separate requirements.

Set `MCP_CLIENT_ID` to the approved client's verified token client identifier. In Wally,
open `/settings/connections`, enable owner permission, select boards and approve a grant.
Connect ChatGPT only after that grant exists. Writes additionally require the deployment
switch, user grant and token scope. A read-only token must be reauthorized with
`wally:write` before write tools become available. Verify this escalation in the real host.
No API key or client secret is shipped to the browser.

Wally revokes its durable grant, not the provider's OAuth refresh token. Existing and
refreshed tokens cannot use a revoked grant. Reapproving the same OAuth client creates
new access for that client; remove its provider authorization as well when the client
itself is no longer trusted. Revocation cannot recall data already delivered.

Before cutover, verify Google and password-reset login, stable existing board IDs,
callback/logout/renewal, MCP discovery, read-only and write escalation, private notes,
membership removal and revocation in ChatGPT. Local emulator/Inspector results do not
prove real-tenant or production compatibility.
