# One Wally account, several Auth0 sign-in methods (account linking) — design

> **Status:** the owner chose the direction on 2026-11-03: option C (explicit link in Wally,
> both sign-ins proven), S1 (only verified accounts claim an address), no S2 (no deletion
> of unverified accounts), same address only, minimal scope with safety first. This
> document is the design for that choice and waits for the owner's approval. Nothing is
> built before that.

Date: 2026-11-03. Auth0 is Wally's permanent identity provider
([ADR-0016](../../adr/ADR-0016-auth0-for-web-and-mcp.md)). Supabase trusts Auth0 tokens
through Third-Party Auth (ADR-0027, on the unmerged `docs/keep-auth0` work). This design
answers the requirement that `docs/AUTH0.md` there records as **Open** in its Signup gate
section.

## Intent

The owner wants one Wally account to be reachable through several sign-in methods
(2026-11-01). Today two things go wrong:

1. **The second method is refused.** A person signs up with email and password, then later
   chooses Google with the same address, or the reverse. Auth0 gives each connection its
   own user, `auth0|…` and `google-oauth2|…`
   ([user IDs](https://auth0.com/docs/manage-users/user-accounts/identify-users)). The
   second identity has no row in `auth_identities`, so `resolveOrCreateIdentity`
   ([identities.ts](../../../apps/api/src/lib/auth/identities.ts)) finds an existing user
   with the same address and answers `403 IDENTITY_NOT_LINKED`. The person has no way
   forward.
2. **An address can be squatted.** Anyone can sign up with a password using someone else's
   address and never verify it. The collision check counts that unverified user, so the
   real owner of the address is refused.

The fix must not weaken what the refusal protects: an account is never handed to someone
because they typed the same email.

## Goals

1. A signed-in person can add their other sign-in method (password or Google, with the
   same verified address) on the Account page. Afterwards either method reaches the same
   account, boards and MCP connections.
2. A person refused because their address already has an account is told what to do.
3. An unverified signup no longer locks the verified owner of the address out.
4. A person can see their sign-in methods and remove one they are not signed in with. This
   is a safety control, for example after losing a Google account.

## Non-goals

- Auth0's own account linking (paid; see [why not](#rejected-alternatives)).
- Automatic linking by email, even when both addresses are verified.
- Linking identities with different addresses.
- Starting a link from the refusal screen. The person signs in the way they did before and
  adds the method from the Account page.
- Moving an identity from one Wally account to another, or merging accounts.
- Deleting unverified or unreachable accounts (S2).
- New sign-in providers. Only today's `Username-Password-Authentication` and
  `google-oauth2` connections.

## Safety rules

These hold for everything below:

1. **Live proof of both identities.** A link needs a fresh sign-in with each method, in
   that order, within 10 minutes. Auth0 advises to "request authentication for both
   accounts before linking occurs"
   ([account linking](https://auth0.com/docs/manage-users/user-accounts/user-account-linking)).
   The pre-hijacking study asks a service merging a password account with a federated one
   to ensure "the user currently controls both accounts"
   ([Sudhodanan and Paverd, USENIX Security 2022](https://www.usenix.org/conference/usenixsecurity22/presentation/sudhodanan)).
2. **Verified and equal addresses.** Both tokens say `email_verified: true`, with the same
   normalized address, which is also the account's stored, verified address. Auth0's own
   linking sample links only "to a verified account"
   ([SPA linking](https://auth0.com/docs/manage-users/user-accounts/user-account-linking/user-initiated-account-linking-client-side-implementation)).
3. **Only verified accounts claim an address (S1).** An unverified account never blocks
   anyone, is never linked to, and never links.
4. **At most one verified account per address.** A partial unique index on
   `users (email) WHERE email_verified` enforces this in the database
   ([PostgreSQL partial indexes, example 11.3](https://www.postgresql.org/docs/current/indexes-partial.html)).
   Today no two accounts share an address (the collision check forbids it), so the index
   needs no data cleanup. The migration still checks.
5. **Nothing revealed to the unproven.** A token with an unverified address learns nothing
   about other accounts.
6. **Wally keeps the mapping.** `(issuer, subject) → user` in `auth_identities` stays the
   only source of truth. No Management API, no M2M credential, no new Action, no spend.

## Sign-in decisions

The auth plugin decides on every request. A **verified holder** is another account whose
stored address equals the token's and is stored as verified.

| Identity | Token's address | Verified holder? | Result                                                                                                                                                                                                           |
| -------- | --------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unmapped | verified        | no               | New account (signup on), as today.                                                                                                                                                                               |
| unmapped | verified        | yes              | `403 IDENTITY_LINK_REQUIRED`. No account is created.                                                                                                                                                             |
| unmapped | unverified      | no               | New account (signup on), as today. Its address cannot activate invites.                                                                                                                                          |
| unmapped | unverified      | yes              | `403 EMAIL_NOT_VERIFIED` (an existing code, `routes/connections.ts`). Nothing about the holder is revealed.                                                                                                      |
| mapped   | verified        | yes              | `403 EMAIL_IN_USE`. Nothing is written. Without this the account would become a second verified account for the address (rule 4). This also covers a provider address that changes to one another account holds. |
| mapped   | anything else   | —                | Signs in, as today.                                                                                                                                                                                              |

With signup off, "new account" rows answer `403 IDENTITY_NOT_LINKED`, as today. The other
rows behave the same.

**The `EMAIL_IN_USE` row** is how S1 stays safe without S2. A squatter's unverified
account can become verified later, either because its holder verifies or because the real
owner resets its password. If a verified account for that address already exists, that
identity is refused, and the squatter's account is never upgraded. A legitimate person can
hit this row too, after an unverified password signup, a Google signup, and then
verifying the password. They keep using Google, and the dead password identity stays
unusable for Wally. This is accepted as a rare cost of keeping it simple.

**Web copy** (English and German, ADR-0007), rendered by `HostedLogin.tsx` from the state
`Auth0SessionProvider.tsx` sets (today one `migration` state):

- `IDENTITY_LINK_REQUIRED`: "This email address already has a Wally account. Sign in the
  way you did before, then add this sign-in method on your Account page."
- `EMAIL_NOT_VERIFIED`: "Verify your email address, then sign in again."
- `EMAIL_IN_USE`: "This email address belongs to another Wally account. Sign in the way
  you used for it."

## The link flow

It follows Auth0's documented user-initiated linking for SPAs
([SPA linking](https://auth0.com/docs/manage-users/user-accounts/user-account-linking/user-initiated-account-linking-client-side-implementation)):
sign in with the first method, redirect to Universal Login with `connection` for the
second, then link. The only difference is the last step, which writes Wally's mapping
instead of calling Auth0.

1. **Start.** On the Account page the person, signed in with identity X, presses "Add
   Google" or "Add email and password". Only methods they do not have yet are offered, and
   only when their account is stored as verified.
2. **Ticket.** `POST /me/sign-in-methods/link-ticket`, a normal authenticated route. The
   API stores a ticket:
   - a SHA-256 hash of a random secret (at least 128 bits);
   - the user id and the account's verified address;
   - an expiry 10 minutes later.

   It returns the secret once.

3. **Second sign-in.** The SPA calls `loginWithRedirect` with the secret in `appState`
   ("used to store state before doing the redirect",
   [auth0-spa-js](https://auth0.github.io/auth0-spa-js/interfaces/RedirectLoginOptions.html))
   and `authorizationParams: { connection, prompt: 'login' }`. `prompt=login` asks for
   re-authentication ([OIDC Core 3.1.2.1](https://openid.net/specs/openid-connect-core-1_0.html#AuthRequest)).
4. **Link.** After the callback, and before its usual `GET /me`, the SPA calls
   `POST /me/sign-in-methods/link` with identity Y's access token and the secret. In one
   transaction the API:
   - finds the ticket by the secret's hash; it must be unused and unexpired;
   - marks the ticket used, whatever happens next;
   - checks that Y's token says verified, with the ticket's address;
   - checks that the account still exists, still holds that verified address, and that Y
     is unmapped;
   - inserts `(Y's issuer, Y's subject) → user`.

   Any failed check answers `409 LINK_FAILED` and binds nothing.

5. **After.** The browser holds Y's tokens, and Y resolves to the same account. On
   `LINK_FAILED` the web app signs out and says: "Linking didn't work. Sign in again and
   retry from your Account page. A new email-and-password sign-in must verify its email
   first."

A new password signup starts unverified, so adding "email and password" needs two rounds.
The first round creates and verifies the Auth0 user and fails at step 4. The second round
links. That is accepted: a short ticket and no retry state are the simpler, safer choice.

## Sign-in methods on the Account page

- `GET /me/sign-in-methods` returns `[{ id, method, linkedAt, current }]`:
  - `id` is opaque, for example a hash of issuer and subject, never the subject itself;
  - `method` is `password`, `google` or `other`, from the `user_id` prefix
    `{identity provider id}|…`
    ([user IDs](https://auth0.com/docs/manage-users/user-accounts/identify-users));
  - `current` marks the identity of the token in use.
- `DELETE /me/sign-in-methods/{id}` removes a mapping, except the current one
  (`409 CURRENT_SIGN_IN_METHOD`). Because the current one can never be removed, the last one
  can't either. Tokens of the removed identity, MCP included, then resolve to nothing and
  follow the decision table.
- A new "Sign-in methods" section on `routes/AccountPage.tsx` shows the list, the "Add …"
  buttons and "Remove".

## Code changes (for the plan)

- **`identities.ts`:**
  - the decision table goes into `resolveOrCreateIdentity`;
  - the collision check counts only verified holders;
  - the `EMAIL_IN_USE` check runs before `syncProfile` would write a verified flag;
  - the bind in step 4 needs to run inside the link transaction. Either `bindKnownIdentity`
    takes the caller's transaction, or a new `linkIdentity` does the insert. Its doc
    comment ("never expose this operation to a public request") is rewritten, because the
    link route, guarded by the ticket, is a public caller.
- **`plugins/auth.ts`:** step 4's route needs a new `authBoundary` that verifies the Auth0
  token but neither resolves nor creates an account. Y is unmapped at that moment. The
  ticket route and the methods routes use the normal boundary.
- **Schema:**
  - a new `identity_link_tickets` table with row level security, like the other tables;
  - the partial unique index on `users`;
  - one Drizzle migration (ADR-0020). Expired tickets are deleted when the next ticket is
    written.
- **Web:**
  - widen the `Auth0ClientPort` types in `auth0Session.ts` for `connection`, `prompt` and
    the secret in `appState`;
  - rework `initialize` and `load`, so that a returning link callback calls link before
    `/me`;
  - the Account page section;
  - three new refusal states in `HostedLogin.tsx`.
- **Shared:** DTOs for the methods list. The new error codes are plain strings, because
  `apiErrorSchema` has no list of codes. Identifiers and test data stay English
  (ADR-0014).
- **Docs in the same PR:**
  - `docs/AUTH0.md` replaces **Open** with these rules;
  - a new ADR, "Several Auth0 identities per Wally account, linked in Wally" (the number
    after ADR-0027), with its index **In production** cell;
  - `docs/SPEC.md` gets the Account page section.

**Other parts:**

- **MCP** resolves through `resolveIdentity`, so a linked method works there with no change.
- **Invites** look up one verified user by address (`.limit(1)`). Rule 4 keeps that lookup
  unambiguous.
- **Supabase Realtime** (ADR-0027, not built) compares `sub`. A user with two methods has
  two subjects, which the server already finds through the mapping. The proof in ADR-0027's
  Confirmation section should include such a user.

## Tests

- **API:**
  - every row of the decision table, with signup on and off;
  - a ticket that is expired, reused or unknown;
  - a mismatched address, an unverified Y, a Y that is already mapped, the account deleted,
    the account's address changed;
  - concurrent verified sign-ins against the partial index;
  - removing the current method and removing another one;
  - MCP through a linked identity.
- **Web unit tests:** the three refusal states, the Account section, the link callback
  before `/me`, the sign-out on `LINK_FAILED`.
- **E2E (CI, Auth0):** the Account page lists one method, with "Add Google" and no
  "Remove". A full Google link in CI would need a Google test account. _My call, following
  "minimal": none is added._ The owner checks one real link once in production after
  release.

## Rejected alternatives

- **Auth0 account linking.** Merging the second Auth0 user into the first, with
  `setPrimaryUser` in a Post Login Action. The pricing table lists "Account Linking" as
  not available on Free, from Essentials up ([pricing](https://auth0.com/pricing)). For
  the Management API link endpoint the docs name no plan, and the overview says the
  "Auth0 plan or custom agreement affect whether this feature is available". ADR-0016
  already excludes it. A community reply claiming support on every plan
  ([thread](https://community.auth0.com/t/clarification-on-auth0-free-plan-connection-limits-account-linking/195461))
  is not identified as coming from Auth0 staff.
- **Automatic link when both addresses are verified.** One fewer step, but it relies on the
  stored flag rather than live proof. Auth0 and the study ask for live proof. Google also
  says not to use `email` as a unique identifier
  ([Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)).

## Evidence (checked 2026-11-03)

- Auth0 pricing, Free: "Account Linking" not available; Actions + Forms 5; M2M 1,000 —
  <https://auth0.com/pricing>
- Auth0 account linking overview: request authentication for both accounts; plan
  dependence — <https://auth0.com/docs/manage-users/user-accounts/user-account-linking>
- Auth0 SPA user-initiated linking: redirect with `connection`, link only to a verified
  account — <https://auth0.com/docs/manage-users/user-accounts/user-account-linking/user-initiated-account-linking-client-side-implementation>
- Management API link endpoint — <https://auth0.com/docs/api/management/v2/users/post-identities>
- Post Login API, `setPrimaryUser` —
  <https://auth0.com/docs/customize/actions/explore-triggers/signup-and-login-triggers/login-trigger/post-login-api-object>
- Auth0 user IDs, `{identity provider id}|{unique id in the provider}` —
  <https://auth0.com/docs/manage-users/user-accounts/identify-users>
- Auth0 email verification: social providers may overwrite `email_verified`; email is not
  proof of identity — <https://auth0.com/docs/manage-users/user-accounts/verify-emails>
- Google OpenID Connect: `email_verified`; use `sub`, not `email` —
  <https://developers.google.com/identity/openid-connect/openid-connect>
- OpenID Connect Core 1.0 §3.1.2.1, `prompt=login` —
  <https://openid.net/specs/openid-connect-core-1_0.html#AuthRequest>
- auth0-spa-js `RedirectLoginOptions.appState` —
  <https://auth0.github.io/auth0-spa-js/interfaces/RedirectLoginOptions.html>
- PostgreSQL partial unique index, example 11.3 —
  <https://www.postgresql.org/docs/current/indexes-partial.html>
- Sudhodanan and Paverd, "Pre-hijacked accounts", USENIX Security 2022 —
  <https://www.usenix.org/conference/usenixsecurity22/presentation/sudhodanan>

## Not verified first-hand

- That Drizzle's `uniqueIndex().where(…)` emits a partial unique index. Its page shows
  `.where()` only on `index()` ([indexes](https://orm.drizzle.team/docs/indexes-constraints)).
  If it does not, the migration creates the index in SQL.
- That a self-service password reset sets `email_verified` to true. Only Auth0's
  [support article](https://support.auth0.com/center/s/article/Reseting-Password-sets-Email-Verified-to-True-but-Does-Not-Send-a-Welcome-Email)
  says so. The `EMAIL_IN_USE` row keeps Wally safe either way.
- Whether Auth0 revokes refresh tokens on a password reset. Rules 3 and 4 do not depend on
  it.
- Where exactly auth0-spa-js keeps `appState` across the redirect. It is browser storage,
  as read from the SDK, but no SDK page was checked. The secret is single-use, expires in
  10 minutes, and alone grants nothing.
- How Google verifies `email_verified` for a Google account with a non-Gmail address. Its
  page defines the claim but not the process.
