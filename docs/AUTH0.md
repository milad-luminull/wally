# Auth0 login and MCP

Auth0 is Wally's only sign-in, in production, local development and CI. Production has
signup open and MCP reads and writes enabled (release variables `AUTH0_SIGNUP_ENABLED`,
`MCP_ENABLED`, `MCP_WRITES_ENABLED`). Firebase login, the earlier local and CI sign-in, is
removed ([DEPLOY.md](DEPLOY.md#firebase-retired)). The decision is
[ADR-0016](adr/ADR-0016-auth0-for-web-and-mcp.md); delivery history is in
[the rollout](rfcs/RFC-0006-auth0-mcp-rollout.md).

Auth0 is to be replaced by Supabase Auth for web login and MCP
([ADR-0021](adr/ADR-0021-supabase-auth-for-web-and-mcp.md),
[RFC-0012](rfcs/RFC-0012-supabase-auth-and-mcp.md)). This page describes production until
that cutover.

## Configuration

The root `.env` feeds Docker Compose. `.env.example` turns signup on for local use and
leaves MCP off:

```dotenv
AUTH0_SIGNUP_ENABLED=true
MCP_ENABLED=false
MCP_WRITES_ENABLED=false
```

**Local run:**

- Nothing else is needed. The web app uses Wally's public SPA client unless
  `VITE_AUTH0_CLIENT_ID` names another. Your first sign-in creates your account in the local
  database; recreate the containers after changing `.env`. An older `.env` without
  `AUTH0_SIGNUP_ENABLED=true` gets `403 IDENTITY_NOT_LINKED` on that first sign-in, because
  compose defaults the switch to `false`.
- The SPA client allows the callbacks `http://localhost:5174/login` and
  `https://wally.luminull.com/login`, with matching web origins and logout URLs. Running the
  web app on any other address, such as a second copy on another port, needs that address
  added to the SPA client's callbacks, web origins and logout URLs first.
- On `http://localhost`, Auth0 asks you to confirm the login again after a page reload. Auth0
  documents that this confirmation "may still appear" for a first-party application "when
  the application uses a non-verifiable callback URI (such as `localhost` …)"
  ([consent](https://auth0.com/docs/get-started/applications/confidential-and-public-applications/user-consent-and-third-party-applications)).
  For the same reason the Playwright suite runs only in CI, which serves the production
  hostnames over HTTPS inside its runner ([E2E README](../apps/web/e2e/README.md)).
- The SPA requests `openid profile email offline_access` and keeps tokens in memory, with
  rotating refresh tokens.
- Never put a client secret in a `VITE_*` variable.

**MCP:** needs `MCP_ENABLED=true` and `MCP_CLIENT_ID`. Leave `MCP_CLIENT_ID`
unset when unused rather than empty.

**Release variables** have the same names. The workflow rejects:

- invalid booleans;
- a missing SPA client ID;
- MCP without a client ID;
- writes without MCP.

The issuer and audiences are pinned in code, not supplied by variables. See
[deployment configuration](DEPLOY.md#configuration).

## Token contract

**Issuer and audiences:**

- The issuer is exactly `https://login.luminull.com/`.
- The REST audience is `https://api.wally.luminull.com`.
- The MCP audience is `https://api.wally.luminull.com/mcp`.
- Tokens are signed with RS256. The API needs no client secret.
- SPA ID tokens are rejected, and each audience accepts only its own tokens.

**Claims:**

- The versioned [Post Login Action](../infra/auth0-post-login.cjs) adds signed email,
  email-verification and name claims for the REST and MCP audiences only.
- Missing claims fail closed. The browser cannot supply a trusted email or verification
  flag.
- Board authorization always runs in Wally.

## Stable account IDs

**Mapping record:**

- A row of `auth_identities`, keyed by `(issuer, subject)`, maps an external identity to a
  Wally user ID.
- Columns: `issuer`, `subject`, `user_id` and `created_at`. No credential or email is
  stored.

**Binding:** `bindKnownIdentity` in
[identities.ts](../apps/api/src/lib/auth/identities.ts) is the only way to bind an
existing user.

- It checks that the target exists, creates the mapping atomically, allows exact
  retries, and refuses reassignment.
- It has no HTTP route.
- Owners are never discovered by email.

**History:** a one-off import on 2026-10-23 mapped every Firebase-era user to Auth0 under
their original Firebase UID (tooling removed in PR #76). The v0.11.0 data reset deleted those
users and mappings; every account since is an Auth0 signup.

## Signup gate

**When `AUTH0_SIGNUP_ENABLED` is false:** an unmapped token returns
`403 IDENTITY_NOT_LINKED`. No account or board is created.

**When it is true:** an unmapped token creates, in one transaction:

- a random Wally user ID;
- its first board;
- its identity mapping.

**Collisions:** a normalized email that matches any existing user denies the signup with
`IDENTITY_NOT_LINKED`. It never links accounts. Concurrent signups are checked inside the
same transaction.

**Unverified email:**

- An unverified email stays unverified and cannot activate board invites.
- Mappings whose Wally user no longer exists fail closed, and are never recreated.

## MCP client

**MCP API:**

- `https://api.wally.luminull.com/mcp` uses RS256 with the scopes
  `wally:read`/`wally:write`.
- Machine-to-machine access is disabled, and user consent is required.
- Resource Parameter Compatibility Profile is enabled, so OAuth `resource` selects this
  audience.
- Access tokens last 900 seconds. Rotating refresh tokens have a seven-day idle limit and
  a 30-day maximum.

**ChatGPT client:**

- ChatGPT uses the public PKCE client `Wally ChatGPT (PKCE)`, `tpc_oR2NUn5BAcms9r5Z5MhHVf`,
  with Authorization Code and rotating refresh tokens.
- Dynamic registration and CIMD are disabled, because Auth0 maps ChatGPT's CIMD client to
  `private_key_jwt`.
  [Auth0 documents that method as Enterprise-only](https://auth0.com/docs/get-started/auth0-overview/create-applications/register-applications-with-cimd).
- The `google-oauth2` and `Username-Password-Authentication` connections are domain-level,
  so every third-party app in the tenant can use them. API grants and Wally permissions
  still apply.

**First request and writes:**

- The first verified MCP request creates the account-wide connection.
- Writes need current edit permission, the deployment switch and the `wally:write` scope.
- See [the connection model](MCP_CONNECTION_MODEL.md) for Disconnect and Reconnect.

**Revocation:**

- Wally revokes its own connection record, not Auth0's refresh token.
- Remove the Auth0 authorization too when a client is no longer trusted.
- Revocation cannot recall data a host has already received.

## Local MCP run

[`docker-compose.mcp-local.yml`](../docker-compose.mcp-local.yml) starts an isolated stack:

- its own PostgreSQL and one-shot `migrate` service (no published database port);
- the API on `http://localhost:4502` (MCP at `/mcp`, metadata at
  `/.well-known/oauth-protected-resource/mcp`);
- MCP Inspector on `http://localhost:6274`. The session URL is printed in the
  `inspector` logs.

```sh
docker compose -f docker-compose.mcp-local.yml up -d --build
docker compose -f docker-compose.mcp-local.yml exec -T api \
  pnpm --filter @wally/api exec tsx src/seed-mcp-local.ts /tmp/identity.json
```

**Local MCP address:**

- `MCP_LOCAL_URL=http://localhost:4502/mcp` changes the advertised resource.
- It is accepted only by a development process whose `DATABASE_URL` is local (`localhost`,
  `127.0.0.1`, `[::1]` or the compose service `postgres`).
- Only that address plus the Inspector origin `http://localhost:6274` are allowed.

**Seeder:**

- The identity file holds the exact Auth0 `subject` and `email` of the tester. It stays
  outside the repository.
- The seeder refuses a non-local `DATABASE_URL` and any `NODE_ENV=production`. It creates synthetic boards
  for a synthetic Wally user, bound to that subject.

**Limits:**

- Do not run a bare `docker compose down` or `make down`. They act on the owner's main
  stack.
- Local Inspector results do not prove production or real-host behavior.
