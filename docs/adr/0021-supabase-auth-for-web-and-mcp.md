# ADR-0021: Supabase Auth for web login and MCP authorization

- **Status:** accepted. The MCP part is gated on the proof in the
  [identity RFC](../rfcs/0012-supabase-auth-and-mcp.md), section 6.
- **Date:** 2026-10-26
- **Deciders:** Milad Rezazadeh
- **Supersedes:**
  - [ADR-0016](0016-auth0-for-web-and-mcp.md). It was never formally accepted, but it
    has served production since v0.9.0.
  - The identity source in [ADR-0004](0004-firebase-auth-with-lazy-provisioning.md). Its
    lazy provisioning stays.

## Context and problem statement

Production signs users in through Auth0, with MCP reads and writes enabled (ADR-0016),
after starting on Firebase Authentication (ADR-0004). Wally maps `(issuer, subject)` to
a stable Wally user ID.

On 2026-10-26 the owner chose to consolidate on Supabase and decommission Auth0 and
Firebase, with MCP still working
([tech stack brief](../researches/2026-10-26-tech-stack-and-architecture.md)).

The question: which system issues web and MCP tokens, and what stays Wally's?

## Decision drivers

- One provider for data, identity and Realtime, on the Free plan.
- Existing accounts keep their Wally IDs. Accounts are never merged by email alone.
- MCP keeps its guarantees:
  - consent;
  - REST and MCP tokens kept apart;
  - the read/write limit;
  - next-call Disconnect;
  - replay safety;
  - private-note isolation.

## Considered options

1. **Supabase Auth for web, and its OAuth 2.1 server for MCP:**
   - Good: one provider.
   - Bad: the OAuth server is beta, and Wally builds the consent page.
2. **Supabase Auth for web, Auth0 kept for MCP:**
   - Good: the MCP flow is already proven.
   - Bad: two identity providers, indefinitely.
3. **Keep Auth0 for both:**
   - Good: no second migration.
   - Bad: contradicts the consolidation. On Free, Auth0's ChatGPT client-metadata path
     is not available, because it relies on an Enterprise-only method ([AUTH0.md](../AUTH0.md)).

## Decision outcome

Chosen option: **option 1**.

- **Web sign-in:** the browser uses the Supabase client for sign-in (Google and
  email/password) and session renewal only. Fastify verifies access tokens against the
  project's JWKS, with the issuer pinned and asymmetric signing keys
  ([getting started](https://supabase.com/docs/guides/auth/oauth-server/getting-started)).
- **Identity mapping:**
  - Identity still resolves through Wally's `(issuer, subject)` mapping.
  - Existing users are pre-created in Supabase with a confirmed email, then bound
    explicitly.
  - Supabase automatically links identities that share a verified email
    ([identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking)).
    So first sign-in checks the expected Google subject; it never trusts the email.
- **What stays Wally's:** roles, invites, privacy, lazy provisioning and the signup gate.
  Supabase roles do not grant board access.
- **MCP:**
  - Supabase's OAuth 2.1 server issues the tokens, and `/mcp` stays a resource server.
  - Wally hosts the consent page.
  - MCP tokens are told apart by their `client_id` claim, or by an `aud` claim set
    through the Custom Access Token hook, which is available on Free
    ([token security](https://supabase.com/docs/guides/auth/oauth-server/token-security),
    [auth hooks](https://supabase.com/docs/guides/auth/auth-hooks)).
  - Supabase documents neither custom scopes nor token revocation. So the read/write
    limit and revocation live in Wally's connection records.
- **Email:** Resend is set up as custom SMTP before real users rely on email. The default
  sender only reaches the project's team
  ([custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)).
- **If the proof fails:** if the MCP guarantees cannot be met with documented features,
  a new ADR decides. Auth0 is not kept silently.

### Consequences

- Good: one identity provider, in the same project as the data.
- Good: rebuilt account deletion can remove the login and the data in one project.
- Good: the mapping, revocation and audit records built for Auth0 are reused.
- Bad: a second identity migration a few weeks after the first.
  - Every MCP connection must re-authorize.
  - Password users reset their password again.
- Bad: the OAuth server is beta, and Wally owns a consent page.
  - The read/write decision moves from OAuth scopes into Wally's own connection
    records.
  - Clients that ask for `wally:read` scopes need a tested answer.
- Neutral:
  - Auth0's tenant, `login.luminull.com` and the Firebase verifier are retired after the
    rollback window.
  - ADR-0009's real-Firebase-Auth test setup is replaced in workstream 3.

### Confirmation

- Tests cover wrong issuers, audiences, clients and expired tokens.
- REST rejects MCP tokens, and `/mcp` rejects REST tokens.
- Tests cover existing-account continuity, invite safety, and Disconnect after a refresh.
- Real ChatGPT acceptance is recorded before cutover.
- No `@auth0/*` or `firebase` packages remain after decommissioning.

## More information

- [Identity RFC](../rfcs/0012-supabase-auth-and-mcp.md), [platform migration](../rfcs/0011-platform-migration.md).
- Behavior to preserve: [connection model](../MCP_CONNECTION_MODEL.md),
  [Wally over MCP](../rfcs/0004-wally-mcp.md).
