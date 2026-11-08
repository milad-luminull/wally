# Auth0 login and MCP

Auth0 is Wally's only sign-in, in production, local development and CI. Production has
signup open and MCP reads and writes enabled (release variables `AUTH0_SIGNUP_ENABLED`,
`MCP_ENABLED`, `MCP_WRITES_ENABLED`). Firebase login, the earlier local and CI sign-in, is
removed ([DEPLOY.md](DEPLOY.md#firebase-retired)). The decision is
[ADR-0016](adr/ADR-0016-auth0-for-web-and-mcp.md); delivery history is in
[the rollout](rfcs/RFC-0006-auth0-mcp-rollout.md).

Where the browser talks to Supabase (planned), Supabase trusts the Auth0 ID token through
Third-Party Auth, as a custom OIDC provider
([ADR-0027](adr/ADR-0027-supabase-trusts-auth0-tokens-through-third-party-auth.md)). Setup:
[Supabase Third-Party Auth](#supabase-third-party-auth).

**Terraform holds the tenant's configuration for Wally** ([`auth0.tf`](../infra/terraform/wally/auth0.tf),
[DEPLOY.md](DEPLOY.md#infrastructure-in-terraform)): the tenant settings, the login prompt,
`login.luminull.com`, the email and Google connections, the Wally Web, Wally ChatGPT (PKCE)
and Wally account deletion applications with their grants, both APIs and the post-login
Action. The tenant's friendly name ("Wally") and the logo on the sign-in and consent pages
are set there too. Change them there: a dashboard change to a setting the code holds shows in the next
plan and is reverted by its apply. Users stay in the dashboard.

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

- The versioned [Post Login Action](../infra/auth0-post-login.cjs) first denies any login or
  refresh-token exchange whose `email_verified` is not `true` (reason `EMAIL_NOT_VERIFIED`,
  shown by the web app as "verify your email"). It then adds signed email,
  email-verification and name claims for the REST and MCP audiences only.
- The same Action adds `role: authenticated` to the **ID token** of Wally's web app client
  and nowhere else. It reads that client's ID from the Action secret `WEB_CLIENT_ID`; without
  the secret, no token gets the claim. Supabase requires that literal
  claim ([ADR-0027](adr/ADR-0027-supabase-trusts-auth0-tokens-through-third-party-auth.md));
  access tokens never carry it, so Supabase runs them as `anon`.
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

Each Wally account has exactly one Auth0 identity: a second sign-in method with an address
an account already holds is refused, and Wally never links or merges accounts
([ADR-0028](adr/ADR-0028-one-auth0-identity-per-account-with-passkeys.md)). The web app tells
the person to sign in the way they signed up.

**Unverified signups get no account.** The Post Login Action denies them before any token is
issued, so an unverified signup cannot hold an address its verified owner then wants.

**Unverified email:**

- Auth0 issues no token for one (above). The API's own checks stay as a second guard: an
  unverified email cannot activate board invites.
- Mappings whose Wally user no longer exists fail closed, and are never recreated.

## Account deletion

Deleting an account (`DELETE /me`) deletes its Auth0 user first, then its Wally data
([design](superpowers/specs/2026-11-03-account-deletion-and-export-design.md)).

- **Client:** a machine-to-machine application authorized for the Auth0 Management API
  with **only** the `delete:users` scope. Its client ID is the production variable
  `AUTH0_MANAGEMENT_CLIENT_ID`; its secret is the Secret Manager secret
  `wally-auth0-management-client-secret`, read by `wally-api` as
  `AUTH0_MANAGEMENT_CLIENT_SECRET` ([DEPLOY.md](DEPLOY.md#account-deletion-setup)).
- **Calls:** through Auth0's Node SDK ([`auth0`](https://github.com/auth0/node-auth0),
  `ManagementClient`), on the tenant's default domain `dev-4tuhqfy0z1yepp5h.eu.auth0.com`
  ([management.ts](../apps/api/src/lib/auth/management.ts)). The SDK gets a
  client-credentials token for `https://dev-4tuhqfy0z1yepp5h.eu.auth0.com/api/v2/`, keeps it
  until shortly before it expires, and sends `DELETE /api/v2/users/{id}`.
- **Only production has the client.** Local development and CI share this tenant but not the
  secret, so their deletions skip Auth0 and log that they did; the CI test users are never
  deleted. The production API refuses to start without the client.
- **Tombstone:** for one hour after a deletion, `deleted_identities` holds the identity, and
  an unmapped token for it answers `401 ACCOUNT_DELETED` instead of signing up again. Access
  tokens last 900 seconds, so a token the browser still holds cannot recreate the account.
  `purge_expired()` removes the row.

## Sign-in methods

Auth0's hosted page offers two connections
([ADR-0028](adr/ADR-0028-one-auth0-identity-per-account-with-passkeys.md)):

- **Google** (`google-oauth2`), the main signup, through the Google OAuth client in
  `luminull-wally-prod`. Its secret comes from the `infrastructure` environment as a
  write-only value.
- **Email** (`Username-Password-Authentication`), with passkeys first and the password as
  fallback. Auth0 requires passwords to stay enabled when passkeys are on, and progressive
  enrollment offers a passkey after a password login
  ([passkey policy](https://auth0.com/docs/authenticate/database-connections/passkeys/configure-passkey-policy)).
  Passkeys are bound to `login.luminull.com`.

**Tenant setup, in this order** (done 2026-11-04, live with v0.15.0):

1. Mark the CI accounts (`+1`, `+2`) as email-verified (Auth0 Dashboard > User Management >
   Users). Otherwise the Action denies E2E.
2. Deploy `infra/auth0-post-login.cjs` to the tenant's Post Login Action.
3. Authentication > Authentication Profile: **Identifier First**
   ([docs](https://auth0.com/docs/authenticate/login/auth0-universal-login/identifier-first)).
   Only after the E2E helper that handles the two-screen login is on `main`; otherwise E2E
   fails on every branch.
4. On `Username-Password-Authentication`: turn **Requires Username** off and enable
   **passkeys**, with progressive enrollment on (Authentication Methods > Passkey).

Terraform now holds steps 2 to 4; step 1 stays by hand for any new CI account.

The E2E helper (`apps/web/e2e/support.ts`) signs in with a password on either login layout
and skips the passkey prompt with Auth0's **Continue without passkeys** button. CI cannot
enter a passkey.

## Supabase Third-Party Auth

Supabase trusts the tenant's ID tokens through a **custom OIDC provider**, not the dedicated
Auth0 integration: that integration only knows `<tenant>.auth0.com` issuers, and Wally's
tokens are issued by `https://login.luminull.com/`
([ADR-0027](adr/ADR-0027-supabase-trusts-auth0-tokens-through-third-party-auth.md)).

**Setup, in this order** (owner, after the PR that adds the `role` claim is merged):

1. In the Post Login Action's editor, add the secret `WEB_CLIENT_ID` (key icon > Add Secret)
   with the web app's client ID, the value of the `VITE_AUTH0_CLIENT_ID` variable
   ([Actions secrets](https://auth0.com/docs/customize/actions/write-your-first-action)).
   The ID is public, but Auth0's editor flags any literal that looks like a key.
2. Deploy `infra/auth0-post-login.cjs` to the tenant's Post Login Action.
3. Supabase Dashboard > project `wally` > Authentication > Sign In / Providers >
   **Third-Party Auth** tab > **Add provider** > **Custom OIDC**, Issuer URL
   `https://login.luminull.com/`
   ([custom OIDC](https://supabase.com/docs/guides/auth/third-party/custom-oidc)). Not the
   **Custom Providers** section at the bottom of the Supabase Auth providers list: that
   adds a sign-in method to Supabase Auth, which Wally does not use. If the form refuses the
   custom domain, stop: no fallback is chosen.
4. Turn every Supabase Auth sign-in method off; Wally creates no users there. On the same
   **Sign In / Providers** page: turn off **Allow new users to sign up** and **Allow
   anonymous sign-ins**; open **Email** and turn the provider off (it is on by default);
   keep Phone, every social provider and **Custom Providers** off or empty. Authentication >
   Users stays empty. Third-Party Auth does not need any of them: Supabase only verifies
   the Auth0 token.

Terraform now holds steps 1 to 3: the Action's `WEB_CLIENT_ID` is a write-only secret taken
from the web client, never stored in state. Step 4 stays by hand, because Supabase Auth's own
settings belong to the project, which stays outside Terraform.

Nothing in Wally sends the ID token to Supabase yet; the first feature that does is the
first real check.

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
  ChatGPT therefore asks for the client ID when a connector is added. Wally's Connected apps
  page (`/settings/connections`) shows it, from the API's `MCP_CLIENT_ID`, next to the
  connector URL; the client secret stays empty.
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
