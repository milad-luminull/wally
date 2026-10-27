# Identity and MCP on Supabase Auth

- **Status:** accepted by the owner on 2026-10-26; nothing built yet. The authorization
  server is in beta, so this RFC is gated on the proof in section 6.
- **Date:** 2026-10-26
- **Decision:** [ADR-0021](../adr/ADR-0021-supabase-auth-for-web-and-mcp.md)
- **Context:** [platform migration](RFC-0011-platform-migration.md), workstream 3. It comes after
  the [data cutover](RFC-0008-firestore-to-supabase.md).
- **Replaces:** the provider choice in [Auth0 login and first MCP release](RFC-0006-auth0-mcp-rollout.md).
  The MCP requirements in that RFC, in [Wally over MCP](RFC-0004-wally-mcp.md) and in the
  [connection model](../MCP_CONNECTION_MODEL.md) still apply.

## 1. Outcome

- **Web sign-in:** Google and email/password, through Supabase Auth.
- **MCP tokens:** ChatGPT connects to `https://api.wally.luminull.com/mcp` with tokens
  issued by Supabase Auth's OAuth 2.1 server.
- **Retired:** Auth0 and Firebase Authentication, after the rollback window.
- **Unchanged behavior:**
  - Wally user IDs, board permissions and verified-email invites.
  - Private notes, MCP connection records, Disconnect and Reconnect.
  - Request and write budgets, and audit provenance.

## 2. What stays Wally's

- **Identity mapping:**
  - External identity resolves through `(issuer, subject)` to a Wally user ID.
  - For Supabase, the issuer is `https://<project-ref>.supabase.co/auth/v1`, as in the
    documented token example
    ([token security](https://supabase.com/docs/guides/auth/oauth-server/token-security)) (or a
    verified custom domain) and the subject is the `auth.users` id.
  - The existing mapping table moves to PostgreSQL in the data cutover. This workstream
    adds Supabase rows to it and never rewrites Wally user IDs.
- **Permissions:** Fastify keeps every role, privacy and invite rule. Supabase roles and
  RLS do not decide board access. The only database policy is the Realtime one in
  ADR-0023.
- **Provisioning:** a new signup still gets its user record and first board on the first
  authenticated request (ADR-0004 and ADR-0011), behind the signup gate.
- **Isolation:** provider code stays at the authentication boundary
  (`apps/api/src/plugins/auth.ts`, `apps/api/src/lib/auth/`, and the web auth provider).
  Board logic never sees provider claims.

## 3. Account migration

There are few accounts. The read-only inventory of 2026-10-22 counted nine Firebase
accounts and seven Wally users. Recount before the import; do not reuse these numbers.

1. **Inventory (read-only):**
   - Read every active Wally user with their Auth0 and Firebase mappings.
   - Classify each as Google or password.
   - Record the result without emails in the repository.
2. **Create Supabase users explicitly**, one per Wally user, through the admin API, with
   the email already confirmed. Automatic linking only applies to verified emails, so an
   unconfirmed pre-created user would leave Google sign-in creating a second Supabase
   user. Then
   write the mapping `(supabase issuer, auth.users.id) → Wally user ID` through a trusted
   binding function. This works like `bindImportedIdentity`: create once, exact retries
   are idempotent, a mapping is never reassigned, and there is no HTTP route.
3. **Google accounts:**
   - The identity is proven by Google's subject when the user first signs in, not by the
     email address.
   - Supabase Auth automatically links a sign-in to an existing user with the same
     verified email
     ([identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking)).
   - So the import must check, on first sign-in, that the linked Google subject equals
     the one recorded for that Wally user. If it does not, deny the sign-in and review
     it.
4. **Password accounts:**
   - These users reset their password through Supabase Auth's recovery email, as with
     the Auth0 move.
   - Exporting hashes from Auth0 is _unverified_ on the Free plan and is not relied on.
   - Recovery needs Resend configured as custom SMTP first. Without it, Supabase sends
     2 emails per hour, and only to team members
     ([custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)).
5. **No email matching** at any step.
   - An unmapped Supabase token returns `403 IDENTITY_NOT_LINKED` while the signup gate
     is off.
   - Production runs with Auth0 signup open (`AUTH0_SIGNUP_ENABLED=true`). There, the
     email-collision check is what stops a new signup from taking over an existing
     account's address.
   - The Supabase verifier gets its own signup gate variable, off by default. The same
     collision denial applies when the gate is on.

## 4. MCP requirements and how Supabase meets them

The OAuth 2.1 server is in **beta**, is available on all plans, and requires the app to
host its own consent page
([getting started](https://supabase.com/docs/guides/auth/oauth-server/getting-started),
[MCP authentication](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication)).

| Wally requirement today                                      | What Supabase documents                                                                                                                                                                                                                                      | Plan                                                                                                                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP tokens are distinct from REST tokens (separate audience) | Access tokens carry `client_id`. `aud` can be changed with the Custom Access Token hook (Free and Pro) ([token security](https://supabase.com/docs/guides/auth/oauth-server/token-security), [auth hooks](https://supabase.com/docs/guides/auth/auth-hooks)) | `/mcp` accepts only tokens whose `client_id` is a registered MCP client, and REST rejects them. Set an MCP `aud` in the hook if the proof shows it works with ChatGPT.                |
| `wally:read` / `wally:write` scopes, with write escalation   | Only `openid email profile phone` are documented, and "Scopes control OIDC data, not database access"                                                                                                                                                        | Move the read/write decision to Wally's connection record. It defaults to read and write, still bounded by the user's role and `MCP_WRITES_ENABLED`. Owner ruling needed (section 7). |
| Next-call revocation (Disconnect)                            | Token revocation is not documented                                                                                                                                                                                                                           | Keep Wally's durable connection record and issuance cutoff. They already revoke on the next call, independent of the provider.                                                        |
| Discovery for MCP clients                                    | Authorization server metadata at `/.well-known/oauth-authorization-server/auth/v1`, and the `withOAuthProtectedResource()` helper in `@supabase/server` ([MCP authentication](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication))        | Keep Wally's own protected resource metadata at `/.well-known/oauth-protected-resource/mcp`, pointing at the Supabase issuer.                                                         |
| ChatGPT as a registered client with PKCE                     | PKCE is mandatory ([OAuth 2.1 server](https://supabase.com/docs/guides/auth/oauth-server)). Public clients have no secret. Dynamic registration is off by default. Redirect URIs must match exactly                                                          | Pre-register one public client for ChatGPT. Keep dynamic registration off unless the proof shows ChatGPT needs it.                                                                    |
| Consent                                                      | Wally hosts the page at a configured authorization path                                                                                                                                                                                                      | Add a consent route in the web app that shows the client and capabilities, then approve or deny.                                                                                      |
| Signed, verifiable tokens                                    | OIDC ID tokens need asymmetric keys, and HS256 is discouraged for OAuth                                                                                                                                                                                      | Switch the project to asymmetric JWT signing keys. Fastify verifies through the project's JWKS with the issuer pinned.                                                                |

**Existing connections:** they hold Auth0 tokens and must re-authorize after cutover. The
connected-apps page needs to say so. Records keep their tombstones, so a revoked app
stays revoked.

## 5. Delivery

1. **Proof on a free project** (section 6).
2. **Behind a switch, in one slice with its own E2E specs** (auth, share, MCP flows):
   - add a Supabase verifier beside Auth0;
   - add the web login and the consent page;
   - add the MCP client handling.
3. **Production cutover:**
   - Import and bind accounts, then switch the web provider and MCP issuer together.
   - Keep the Auth0 verifier and mappings for the rollback window.
   - Validate login, account continuity, real ChatGPT OAuth, reads, writes, conflicts,
     denial and revocation.
4. **Retire:**
   - Auth0: its tenant, its client registrations and `login.luminull.com`.
   - The Firebase verifier and the `firebase` web SDK.

## 6. Proof required before step 2

On a free project:

- ChatGPT connects to a test `/mcp` with a Supabase-issued token.
- REST rejects MCP tokens, and MCP rejects REST tokens.
- Disconnect blocks the next call, including after a refresh.
- Reconnect requires a new authorization.
- Google sign-in links to the pre-created user as expected.
- What ChatGPT does today:
  - `/mcp` advertises `scopes_supported: ['wally:read', 'wally:write']`.
  - It challenges with `wally:read` in `WWW-Authenticate` (`apps/api/src/routes/mcp.ts`).
  - The proof records what ChatGPT then requests from Supabase, and which scope values
    Wally advertises instead.
- **Verified email:** automatic connection creation needs a trusted verified-email
  signal in the token. The documented example token has `email` but no verification
  flag. Prove that the Custom Access Token hook can add one. That it can is _unverified_.
- **Token issue time:** Reconnect's issuance cutoff needs `iat`. The documented example
  token includes it.

If any of these cannot be met with documented features, stop and bring a new ADR.
Auth0 is not kept silently, and Wally does not run its own authorization server.

## 7. Open owner rulings

- **Read and write:** the token cannot carry `wally:read`/`wally:write`. Should a
  connection get both by default, bounded by role and the deployment switch? The
  alternative is a per-connection "allow writes" choice in Wally.
- **Sign-in methods:** keep email/password, or offer Google and email one-time codes only.
- **Domain:** use the Supabase project URL as the issuer, or a custom auth domain. A
  custom domain needs a paid add-on and is _unverified_.
