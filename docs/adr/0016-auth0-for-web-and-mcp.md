# ADR-0016: Auth0 for web login and MCP authorization

- **Status:** proposed
- **Date:** 2026-10-19
- **Deciders:** Milad Rezazadeh

## Context and problem statement

Wally currently uses Firebase Authentication and has no MCP implementation. The owner
has selected Auth0 and requires a Free-plan design with clear boundaries and existing
accounts preserved. The [MCP RFC](../rfcs/WALLY_MCP.md) specifies delegated board access
but leaves the authorization implementation open. Which system should issue web and MCP
tokens, and how should Wally retain ownership of identity and permissions?

## Considered options

1. **Auth0 for web and MCP:** one long-term identity provider and managed OAuth; requires
   migrating existing login and safely mapping accounts.
2. **Firebase login plus Auth0 for MCP:** less initial browser change; retains two
   authentication systems and account-linking responsibilities indefinitely.
3. **An embedded OAuth provider beside Firebase:** avoids another hosted provider;
   Wally must operate protocol storage, signing keys, consent and registration.

## Decision outcome

Choose **Auth0 for web login and MCP authorization**, delivered in stages. Google remains
the sign-in option; this authentication rollout keeps Google hosting and uses the active
application data store. The [Supabase migration](../rfcs/FIRESTORE_TO_SUPABASE.md) is separate.
This proposed decision
replaces ADR-0004's Firebase-specific identity source when accepted and implemented,
not its application-owned permissions or safe user provisioning. Local/CI authentication
guidance in ADR-0009 must be reconciled during migration. Existing accepted ADRs remain
unchanged while this proposal is under review.

The React SPA obtains access tokens; Fastify validates them with issuer and audience
checks. REST and MCP have distinct audiences and authentication boundaries. Auth0 handles
OAuth issuance; `/mcp` is a resource server, not a second authorization server.

Use `https://api.wally.luminull.com` as the public REST base/audience and
`https://api.wally.luminull.com/mcp` as the MCP endpoint/resource/audience. Login uses
`https://login.luminull.com/`. Discovery, client configuration and deployment checks must
agree with these canonical URLs; Cloud Run hostnames remain infrastructure details.

External identity resolves through `(issuer, subject)` to an internal Wally user ID.
Preserve existing IDs and data references. Account migration requires proof of identity;
email matching alone is insufficient. Wally retains role checks, verified-email invite
rules and per-connection scope/revocation checks. MCP invokes the existing authorized
query and command layer, with trusted connection provenance and no independent data path.

Depend only on Free-plan capabilities, not trial access to paid features. Application-owned
identity mapping does not use Auth0's paid Account Linking feature. Keep provider-specific
claims and libraries at authentication boundaries, outside board business logic.

### Consequences

- Good: one managed issuer, reusable login at `login.luminull.com`, and shared permission
  enforcement for browser, assistant and external clients.
- Bad: another service dependency and data processor; free limits or feature changes may
  require payment or migration. Existing email/password accounts need a migration decision.
- Bad: Wally still owns safe identity mapping and durable connection revocation; managed
  OAuth does not make those automatic.
- Neutral: domain verification is complete, but web migration and all MCP work remain pending.

### Confirmation

Verify existing-account continuity, token rejection, account switching and invite safety.
Then prove read-only consent, scope enforcement, private-note isolation, replay safety
and next-call revocation across instances, with Free-plan entitlements and a real MCP host.

## More information

- [Scope, boundaries and delivery gates](../rfcs/AUTH0_MCP_ROLLOUT.md)
- [Current identity decision](0004-firebase-auth-with-lazy-provisioning.md)
- [Current local/CI authentication](0009-docker-compose-with-firestore-emulator-and-real-auth.md)
- [Existing board operations](../architecture/board-operations.md)
