# ADR-0027: Supabase trusts Auth0 tokens through Third-Party Auth

- **Status:** accepted
- **Date:** 2026-11-03, amended 2026-11-05 (custom OIDC provider; no proof)
- **Deciders:** Milad Rezazadeh

## Context and problem statement

Auth0 is Wally's identity provider for web sign-in and MCP authorization
([ADR-0016](ADR-0016-auth0-for-web-and-mcp.md)). Fastify verifies Auth0 access tokens and
resolves `(issuer, subject)` to a Wally user ID. Supabase serves PostgreSQL, reached only
through the API ([ADR-0020](ADR-0020-supabase-postgres-through-the-api-with-drizzle.md)).

Two planned features have the browser talk to Supabase directly: Realtime notification
events ([ADR-0023](ADR-0023-supabase-realtime-for-notification-events.md)) and, if chosen,
Storage uploads ([uploads RFC](../rfcs/RFC-0009-uploads-and-retrieval.md)). Supabase must
then know who the browser is. Which token does it trust?

## Decision drivers

- One identity provider. No user directory in Supabase.
- Free plan only, and nothing spent without the owner's approval.
- MCP and REST tokens must not open Supabase channels.
- Provider code stays at the authentication boundary.

## Considered options

1. **Supabase Third-Party Auth trusting Wally's Auth0 tenant:**
   - Good: documented, and Supabase's APIs only verify, never issue, these tokens.
   - Bad: database policies depend on the shape of an Auth0 token.
2. **Fastify mints Supabase-format tokens with the project's signing secret:**
   - Good: the claims are Wally's own.
   - Bad: a long-lived signing secret in the API; Supabase says this workaround is no
     longer needed ([Third-Party Auth](https://supabase.com/docs/guides/auth/third-party/overview)).
3. **No browser access to Supabase:** SSE from Fastify and API-signed URLs only.
   - Good: one authorization point.
   - Bad: undoes ADR-0023, and each open stream keeps a Cloud Run instance busy.

## Decision outcome

Chosen option: **option 1**.

- **Trust:** the Supabase project adds a **custom OIDC provider** with the issuer
  `https://login.luminull.com/` (Authentication > Third-Party Auth). Supabase requires the
  discovery document at `<issuer>/.well-known/openid-configuration`, asymmetrically signed
  tokens with a `kid`, and a `role` claim; symmetric HS256 is not supported
  ([custom OIDC](https://supabase.com/docs/guides/auth/third-party/custom-oidc)). Wally's
  tenant serves that document at its custom domain, with the same issuer, and signs ID
  tokens with RS256 (checked 2026-11-05).
- **Not the dedicated Auth0 integration:** it is configured by tenant ID and region only
  ([Auth0 integration](https://supabase.com/docs/guides/auth/third-party/auth0)), and the
  Supabase CLI derives its issuer as `https://<tenant>[.<region>].auth0.com`
  ([CLI source](https://github.com/supabase/cli/blob/main/packages/config/src/auth/third_party.ts)).
  Wally's tokens are issued by the custom domain, which passkeys are bound to
  ([ADR-0028](ADR-0028-one-auth0-identity-per-account-with-passkeys.md)), so that
  integration would refuse them.
- **Token:** the browser passes its Auth0 **ID token** through supabase-js's `accessToken`
  option. Supabase requires a literal `role` claim, and Auth0 strips non-namespaced claims
  from access tokens, so Wally's Post Login Action sets `role: authenticated` on the ID
  token only, and only for Wally's web app client, whose ID the Action reads from its
  secret `WEB_CLIENT_ID` (same page). `authenticated` is the
  PostgreSQL role Supabase runs signed-in requests as, and Supabase's docs name that
  value; Wally adds no role of its own.
- **Access tokens stay out:** REST and MCP access tokens carry no `role` claim, so Supabase
  runs them as `anon` ([custom OIDC](https://supabase.com/docs/guides/auth/third-party/custom-oidc)).
  Policies grant only `authenticated` and also check `iss` and `aud` (the SPA client),
  as Supabase's own third-party examples do.
- **Subject, not `auth.uid()`:** policies compare against `auth.jwt() ->> 'sub'`, the
  Auth0 subject. Auth0 subjects are not UUIDs. The server finds a recipient's subjects
  through Wally's identity mapping.
- **Supabase Auth stays unused.** It cannot be disabled
  ([overview](https://supabase.com/docs/guides/auth/third-party/overview)); Wally enables
  no sign-in method in it and creates no users there.
- **The boundary Wally keeps:** the API's `AccessTokenVerifier` and `VerifiedIdentity`
  (`apps/api/src/lib/auth/auth0.ts`), the `(issuer, subject)` mapping
  (`apps/api/src/lib/auth/identities.ts`) and the web `AuthProvider`
  (`apps/web/src/features/auth/`). Board logic never sees provider claims. No further
  abstraction is added.

### Consequences

- Good: one identity provider, and no account ever moves between providers.
- Good: Free covers 50,000 third-party monthly active users
  ([usage](https://supabase.com/docs/guides/platform/manage-your-usage/monthly-active-users-third-party)).
- Bad: Realtime and Storage policies depend on Auth0's claim names and on one Action.
- Bad: a rotated Auth0 signing key can take up to 30 minutes to reach Supabase (overview).
- Neutral: whether the dashboard's custom OIDC form accepts the custom-domain issuer is
  _unverified_ until the owner adds it; the documentation states no restriction on the
  issuer beyond HTTPS and the discovery document.

### Confirmation

- Tests of the Post Login Action (`scripts/auth0-post-login.test.mjs`) show that only the
  web app's ID token carries `role: authenticated`, and no access token does.
- No separate proof (owner, 2026-11-05). The first feature that sends this token to
  Supabase shows that Supabase accepts it, and that REST and MCP access tokens are refused.

## More information

- [Platform migration](../rfcs/RFC-0011-platform-migration.md), workstream 3.
- Auth0 setup and the Post Login Action: [AUTH0.md](../AUTH0.md).
