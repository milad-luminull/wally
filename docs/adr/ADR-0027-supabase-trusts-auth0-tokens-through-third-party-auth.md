# ADR-0027: Supabase trusts Auth0 tokens through Third-Party Auth

- **Status:** accepted
- **Date:** 2026-11-03
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

1. **Supabase Third-Party Auth with Auth0 as the provider:**
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

- **Trust:** the Supabase project adds Auth0 as a third-party provider. It needs
  asymmetrically signed tokens with a `kid`; Auth0's RS256 is supported, HS256 and PS256
  are not ([Auth0 integration](https://supabase.com/docs/guides/auth/third-party/auth0)).
- **Token:** the browser passes its Auth0 **ID token** through supabase-js's `accessToken`
  option. Supabase requires a literal `role` claim, and Auth0 strips non-namespaced claims
  from access tokens, so Wally's Post Login Action sets `role: authenticated` on the ID
  token only (same page).
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
- Neutral: Wally's tokens are issued by the custom domain `https://login.luminull.com/`.
  Whether the Auth0 integration, configured by tenant ID, accepts that issuer is
  _unverified_; Supabase's custom OIDC provider takes any HTTPS issuer with a discovery
  document and is the fallback.

### Confirmation

Before the first feature that uses it, a proof on a free project shows that:

- an Auth0 ID token from `login.luminull.com` joins the user's own private Realtime
  channel, with the Data API off;
- the same token cannot join another user's channel;
- REST and MCP access tokens are refused.

## More information

- [Platform migration](../rfcs/RFC-0011-platform-migration.md), workstream 3.
- Auth0 setup and the Post Login Action: [AUTH0.md](../AUTH0.md).
