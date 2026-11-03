# One Wally account, several Auth0 sign-in methods (account linking) — design

> **Status:** proposed, 2026-11-03. Waiting for the owner's choice of option and answers to
> [the questions](#questions-for-the-owner). Nothing is built until the owner approves.

Date: 2026-11-03. Auth0 is Wally's permanent identity provider
([ADR-0016](../../adr/ADR-0016-auth0-for-web-and-mcp.md)); Supabase trusts Auth0 tokens
through Third-Party Auth (ADR-0027, on the unmerged `docs/keep-auth0` branch). This design
answers the requirement that `docs/AUTH0.md` on that branch records as **Open** in its Signup
gate section.

## Intent

The owner wants one Wally account to be reachable through several sign-in methods
(2026-11-01). Today two things go wrong:

1. **Second method refused.** A person signs up with email and password, then later chooses
   "Continue with Google" with the same address (or the reverse). Auth0 gives each
   connection its own user, `auth0|…` and `google-oauth2|…`
   ([user IDs](https://auth0.com/docs/manage-users/user-accounts/identify-users)). The second
   identity has no row in `auth_identities`. `resolveOrCreateIdentity`
   ([identities.ts](../../../apps/api/src/lib/auth/identities.ts)) finds an existing user with
   the same normalized email and answers `403 IDENTITY_NOT_LINKED`. The web app shows its
   generic "not linked" screen. There is no way forward.
2. **Address squatting.** Anyone can sign up with password using someone else's address and
   never verify it. The collision check counts that unverified user. The real owner of the
   address, signing in verified through Google, is then refused.

The fix must not weaken what the refusal protects: an account is never handed to someone
because they typed the same email.

## Goals

1. A person can add a second Auth0 sign-in method (password or Google) to their existing
   Wally account and then reach the same account, boards and MCP connections through
   either.
2. A person who is refused because their address already has an account is told what to
   do, and can link right there.
3. An unverified signup can no longer lock the verified owner of that address out of Wally.
4. A person can see their sign-in methods in Settings and remove one, but never the last.

## Non-goals

- Auth0's own account linking (merging Auth0 users). See [option A](#option-a-auth0-account-linking).
- Merging two existing Wally accounts with data. Today no person can hold two accounts
  with the same address (the collision check forbids it), so there is nothing to merge.
- Linking identities with different email addresses. See [question 3](#questions-for-the-owner).
- New sign-in providers. Only the two connections enabled today: `Username-Password-Authentication`
  and `google-oauth2` (`docs/AUTH0.md`, ChatGPT client section).
- Changing Supabase Third-Party Auth (ADR-0027). See [consequences](#consequences-for-other-parts).

## Anti-goals (a failure even if it works)

- Linking because two emails match, without proof that one person controls both identities.
- Linking to, or through, an identity whose email is unverified.
- Telling a stranger which sign-in methods an address uses, or that it has an account,
  before they have proven they control the address.
- Any spend, or any Auth0 feature outside the Free plan.

## Constraints

- **Auth0 Free only.** Wally does not use Auth0's paid Account Linking (ADR-0016). No spend
  without the owner's approval.
- **Wally keeps the mapping.** `(issuer, subject) → user` in `auth_identities` stays the
  only source of truth. `bindKnownIdentity` stays the only way to bind to an existing user.
  It gets one new caller, the link endpoint.
- **Proof before linking.** Both identities must have a verified email (the owner's rule).
  This design also asks for live sign-in with both, as Auth0 advises: "request
  authentication for both accounts before linking occurs"
  ([account linking](https://auth0.com/docs/manage-users/user-accounts/user-account-linking)).
- **Provider claims stay at the boundary** (ADR-0016, ADR-0027). Board logic never sees
  subjects.

## What Auth0 Free offers (checked 2026-11-03)

| Feature                                                                                      | Free?                                                                                                                                      | Source                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account Linking (Auth0 merges a secondary user into a primary)                               | **No.** The pricing table lists Account Linking as not available on Free, from Essentials up.                                              | [pricing](https://auth0.com/pricing)                                                                                                                                                                 |
| Management API "link a user account" (`POST /api/v2/users/{id}/identities`)                  | The endpoint page names no plan. The linking overview says "your Auth0 plan or custom agreement affect whether this feature is available". | [endpoint](https://auth0.com/docs/api/management/v2/users/post-identities), [overview](https://auth0.com/docs/manage-users/user-accounts/user-account-linking)                                       |
| Post Login Actions, including `api.authentication.setPrimaryUser` (used after Auth0 linking) | Actions yes, up to 5 under "Actions + Forms".                                                                                              | [pricing](https://auth0.com/pricing), [post-login API](https://auth0.com/docs/customize/actions/explore-triggers/signup-and-login-triggers/login-trigger/post-login-api-object)                      |
| `/authorize` with `connection` (pick the method) and `prompt`                                | Yes, standard parameters of the login request.                                                                                             | [authorize](https://auth0.com/docs/api/authentication/authorization-code-flow-with-pkce/authorize-with-pkce), [OIDC Core 3.1.2.1](https://openid.net/specs/openid-connect-core-1_0.html#AuthRequest) |
| Machine-to-machine tokens (needed to call the Management API)                                | 1,000 a month.                                                                                                                             | [pricing](https://auth0.com/pricing)                                                                                                                                                                 |

A community reply of 2025-12-13 says linking "is supported on all Subscription types"
([thread](https://community.auth0.com/t/clarification-on-auth0-free-plan-connection-limits-account-linking/195461)).
The page does not identify the author as Auth0 staff, and it contradicts the pricing table.
This design follows the pricing table and ADR-0016.

## Options

### Option A: Auth0 account linking

A Post Login Action or the API calls the Management API to make the second Auth0 user a
secondary identity of the first. `setPrimaryUser` then makes every login return the
primary `sub`, so Wally sees one subject.

- Good: Wally sees one subject per person, so `auth_identities` and Supabase policies need no change.
- Bad: Account Linking is listed as not available on Free. The Management API path is
  unclear for Free, which makes it a dependency on a feature Auth0 may withhold or bill for.
- Bad: ADR-0016 already rules it out. Using it means reopening that ADR.
- Bad: Auth0 drops the secondary user's metadata, and deleting the primary deletes the
  secondary ([overview](https://auth0.com/docs/manage-users/user-accounts/user-account-linking)).
  It also adds an M2M credential with `update:users` to the API or the Action.

**Rejected.**

### Option B: automatic link on a matching verified email

At the first sign-in of an unmapped identity, if its email is verified and exactly one
existing user has the same address stored as verified, Wally binds the new identity to that
user.

- Good: no extra step for the person. It meets the owner's minimum rule (both addresses
  verified).
- Bad: Wally relies on the stored `users.email_verified`, which is only as fresh as the
  last sign-in of that account's identity, not on live proof. Auth0 asks for authentication
  of both accounts before any link, automatic or manual
  ([overview](https://auth0.com/docs/manage-users/user-accounts/user-account-linking)). The
  pre-hijacking study recommends that a service merging a password account with a federated
  one "must ensure the user currently controls both accounts"
  ([Sudhodanan and Paverd, USENIX Security 2022](https://www.usenix.org/conference/usenixsecurity22/presentation/sudhodanan)).
- Bad: Google says not to use `email` as a unique identifier
  ([Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)).
  Option B does exactly that, even if only once.

### Option C: explicit link in Wally, both identities signed in (recommended)

The person proves both identities live, one after the other, within a few minutes. Wally
then binds the second identity to the account of the first. This follows Auth0's documented
user-initiated linking flow
([SPA flow](https://auth0.com/docs/manage-users/user-accounts/user-account-linking/user-initiated-account-linking-client-side-implementation)).
The SPA signs in with the primary, then redirects to Universal Login with `connection` for
the second method, then links. The one difference: the last step writes to Wally's
`auth_identities`, not to Auth0. That step needs nothing outside Free. That sample also
refuses a secondary whose email is unverified. Wally keeps that rule.

- Good: live proof of both identities, as Auth0 and the study ask. Wally keeps the mapping.
  No Management API, no M2M credential, no new Action.
- Good: one mechanism serves both starting points: Settings ("add Google") and the refusal
  screen ("this address already has an account, sign in the way you did before").
- Bad: one extra sign-in, once per added method.
- Bad: Wally owns a small piece of state, the link ticket, and its expiry.

### Address squatting (applies to B and C)

- **S1, recommended:** only verified holders block. The collision check counts an existing
  user only if `email_verified` is stored true. An unverified holder never blocks a newcomer,
  is never a link target, and can never link.
- **S2, optional, on top of S1:** delete Wally accounts that stay unverified for N days. The
  study recommends "periodically deleting unverified accounts". This deletes user data, so
  it is the owner's call ([question 2](#questions-for-the-owner)).

Under S1 one address can belong to two Wally accounts: one unverified, one verified. The
`users.email` column is already not unique ("identities, not emails, identify a person",
`schema/accounts.ts`). Invite activation already requires a verified address.

S1 also needs one new rule: **at most one account per address is stored as verified.**
Without it, the unverified account could later become verified, by its holder verifying
or by the real owner resetting its password. Then two verified accounts would share one
address, and `member.invite` (`.limit(1)`) would pick one arbitrarily. Enforcement:

- A partial unique index on `users (email) WHERE email_verified`. This is a PostgreSQL
  feature ([partial indexes, example 11.3](https://www.postgresql.org/docs/current/indexes-partial.html)).
- Wherever the profile is written (`resolveOrCreateIdentity`, `syncProfile`), a token's
  `email_verified: true` is stored as true only if no other account holds the address as
  verified. Otherwise the account stays unverified in Wally. This document calls it
  **shadowed**: it keeps working, but cannot activate invites or connect MCP (that already
  needs a verified email, `routes/connections.ts`). The same rule covers a provider address
  that later changes to one another account holds.
- The person reaches their verified account by linking the shadowed account's identity to
  it. The link flow allows that move. See [the link flow](#the-link-flow).

Today no two accounts share an address, because the collision check forbids it. The index
can therefore be created without cleaning up data first. The migration still checks this.

## Recommended design (option C with S1)

### Decision at first sign-in of an unmapped identity

`resolveOrCreateIdentity` with signup on. "Holder" means an existing user with the same
normalized email and `email_verified = true`.

| Newcomer's email | Verified holder exists? | Result                                                                                                                                                                                                                    |
| ---------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| verified         | no                      | New account, as today.                                                                                                                                                                                                    |
| verified         | yes                     | `403 IDENTITY_LINK_REQUIRED`. No account is created. The body tells the person which methods the holder uses (see below). Revealing this is acceptable here, because the newcomer has just proven control of the address. |
| unverified       | no                      | New account, as today. Its unverified email cannot activate invites.                                                                                                                                                      |
| unverified       | yes                     | `403 EMAIL_NOT_VERIFIED`. No account is created, and nothing about the holder is revealed. The web app asks the person to verify their email and sign in again. After that, the row above applies.                        |

With signup off (`AUTH0_SIGNUP_ENABLED=false`), the "new account" rows answer
`403 IDENTITY_NOT_LINKED`, as today. The rows with a verified holder behave as above.
Linking creates no account, so the link routes work whatever the signup switch says.
_(Builder's reading, decided here: the switch gates account creation, not linking.)_

**Code changes this needs:**

- `EMAIL_NOT_VERIFIED` already exists (`routes/connections.ts`). The refusal reuses the code.
- `apiErrorSchema` (`packages/shared/src/schemas/error.ts`) has no field for details. It
  gets an optional `methods` array, used only by `IDENTITY_LINK_REQUIRED`.

**Method labels.** Auth0 builds `user_id` as `{identity provider id}|{unique id in the provider}`
([user IDs](https://auth0.com/docs/manage-users/user-accounts/identify-users)). The API turns
the prefix into a label: `auth0` is "email and password", `google-oauth2` is "Google",
anything else is "other". The label goes in the body as an enum, never the subject.

### The link flow

A **link ticket** carries the proof of the first sign-in across the redirect to the second.

1. **Start.** The person is signed in with identity X. They press "Add Google" in Settings,
   or "Sign in the way you did before" on the refusal screen.
   **Terms.** The **target** is the account that ends up with both methods: an account
   stored as verified. The **moving identity** is the other one. It is either unmapped (the
   refusal case, or a new method from Settings) or the only identity of a shadowed account.

2. **Ticket.** The SPA calls `POST /me/sign-in-methods/link-ticket` with X's access token.
   The API checks that X's token says the email is verified, and that X either maps to the
   target or is a moving identity with a target for its address. It stores a ticket row:
   - X's issuer, subject and normalized email;
   - the target's Wally user id;
   - creation time, an expiry 30 minutes later (time to verify a new password signup's
     email), and a used time.

   It stores only a SHA-256 hash of the ticket secret and returns the secret once.

3. **Second sign-in.** The SPA calls `loginWithRedirect` with the secret in `appState`
   ("used to store state before doing the redirect",
   [auth0-spa-js](https://auth0.github.io/auth0-spa-js/interfaces/RedirectLoginOptions.html))
   and `authorizationParams: { connection, prompt: 'login' }`. `prompt=login` asks the
   provider to re-authenticate ([OIDC Core 3.1.2.1](https://openid.net/specs/openid-connect-core-1_0.html#AuthRequest)).
   Today the app passes `prompt: 'login'` only after an auth error
   (`Auth0SessionProvider.tsx`), and never `connection`. The `Auth0ClientPort` types in
   `auth0Session.ts` widen for both and for the secret in `appState`.
4. **Complete.** After the callback, the SPA calls `POST /me/sign-in-methods/link` with
   identity Y's access token and the secret, **before** its usual `GET /me`. This means
   reworking `initialize` and `load` in `auth0Session.ts`, which today keep only
   `appState.returnPath` and then load `/me`. The checks run in one transaction:
   - the ticket exists, is unused and unexpired;
   - Y's email is verified and equals the ticket's email;
   - the target still exists and is stored as verified;
   - one of X and Y maps to the target, and the other is the moving identity.

   It then binds the moving identity to the target and marks the ticket used. A moving
   identity that was a shadowed account's only identity leaves that account with none. The
   account stays in the database, unreachable (see [question 2](#questions-for-the-owner)).
   `bindKnownIdentity` today opens its own transaction and refuses any reassignment. It is
   refactored to run inside the caller's transaction, and gets a separate move operation
   for the shadowed case. Its doc comment ("never expose this operation to a public
   request") is rewritten: the link route is now a public caller, guarded by the ticket.

5. **After.** The browser now holds Y's tokens. Y resolves to the target, so the person is
   signed in to their account, now with two methods.

**When step 4 fails.** The browser holds only Y's tokens (the SDK keeps one session in
memory), so the person is no longer signed in as X:

- **Y's email is not verified yet.** This always happens when "Add email and password"
  creates a new Auth0 database user. The API answers `409 LINK_FAILED` with reason
  `EMAIL_NOT_VERIFIED` and leaves the ticket unused. The web app shows "Verify your email,
  then continue". Continue repeats step 3 with the same secret, kept in memory. Cancel
  signs out. A reload loses the secret, and the person starts again from X.
- **Any other reason** (expired, used, wrong email, target gone): the ticket is marked used.
  The web app signs out and says "Linking didn't work. Sign in again and retry from Settings."

_(Builder's calls, decided here: the 30-minute expiry, the retry state, and signing out on
other failures.)_

**Routes and the auth plugin.** Both link routes must verify the token without resolving
or creating an account. In the refusal case X is unmapped, so the global preHandler
(`plugins/auth.ts`) would refuse it before step 2 runs. The plugin already exempts routes
by `authBoundary`. Both routes get a new boundary that verifies the Auth0 token and does
nothing else. The decision table already keeps Y from creating an account before step 4,
because a verified holder exists. Calling link before `GET /me` is a second guard.

### Sign-in methods in Settings

- `GET /me/sign-in-methods` lists the user's identities as `{ id, method, linkedAt, current }`.
  `id` is an opaque Wally id, not the subject. `current` marks the identity of the token in
  use.
- `DELETE /me/sign-in-methods/{id}` removes a mapping. It refuses the last one
  (`409 LAST_SIGN_IN_METHOD`). Removing the method currently in use is allowed. The session
  ends on the next request, which then follows the decision table.
- A new "Sign-in methods" section on the account page (`routes/AccountPage.tsx`) shows the
  list. It offers "Add email and password" or "Add Google" for a method not yet present,
  and "Remove" when there are two or more. _(Builder's call: the account page, not a new
  page.)_
- Adding "email and password" means the person needs an Auth0 database user with the same
  address, which they create through Universal Login's sign-up. Its email must be verified
  before step 4 succeeds. The web app tells them so.

### Data

- A new table, `identity_link_tickets`, holds the ticket fields from step 2. It enables row
  level security like the other tables. Used or expired rows are deleted on the next ticket
  write for the same subject, or by a periodic `DELETE … WHERE expires_at < now() - interval '1 day'`.
  How rows are cleaned up is the builder's call.
- `auth_identities` is unchanged. Any number of rows may already point at one user.
- Drizzle migration as usual (ADR-0020).

### Consequences for other parts

- **MCP.** `routes/mcp.ts` resolves through `resolveIdentity`, so MCP tokens from either
  method reach the same user. MCP connections belong to the user, not the identity. Removing
  a method makes its tokens fail with `IDENTITY_NOT_LINKED` on the next call.
- **Profile sync.** `syncProfile` copies email, name and `email_verified` from whichever
  identity signed in. Linking requires equal emails, so this does not change today's
  behavior. If a provider's address changes later, the stored email follows the last sign-in.
  That is today's behavior too.
- **Supabase Realtime (ADR-0027, not built).** Policies compare `auth.jwt() ->> 'sub'`.
  With several identities per user, a recipient has several subjects. ADR-0027 already
  says the server finds them through the mapping. The proof listed in its Confirmation
  section should cover a user with two methods.
- **Invites.** `member.invite` looks up one verified user by email (`.limit(1)`). The
  partial unique index keeps at most one verified account per address, so this lookup
  stays unambiguous.

### Errors and copy

- New codes: `IDENTITY_LINK_REQUIRED`, `LINK_FAILED` and `LAST_SIGN_IN_METHOD`.
  `EMAIL_NOT_VERIFIED` is reused. The shared package has no list of codes. Codes are
  plain strings in `apiErrorSchema`.
- `Auth0SessionProvider.tsx` sets the refusal state. `HostedLogin.tsx` renders it, today
  with the `auth.hosted.migration` key. The new states (link required, verify first, link
  failed) get English and German catalogue entries (ADR-0007). Identifiers and test data
  stay English (ADR-0014).

## Security notes

- **Stolen ticket.** The secret sits in the SPA's memory. Across the redirect it also sits
  in the browser storage where auth0-spa-js keeps `appState`. The API holds only its hash.
  Using it still requires a fresh sign-in as an identity with the same verified address. A
  thief who also controls that address could already reset the password.
- **Replay and races.** A ticket is single-use and checked inside the transaction that
  binds. `bindKnownIdentity` already refuses to reassign a mapped identity.
- **Enumeration.** Methods are revealed only to a token whose verified email equals the
  holder's. With signup off, or with an unverified token, nothing is revealed.
- **Pre-hijacking.** Under S1 a squatter's account is never a link target. Suppose the real
  owner, who already has a verified account, resets the squatter's Auth0 password. Auth0
  then marks the email verified. Auth0's support article says this, but its main docs do
  not, so it is listed below as not verified first-hand. Signing in with that password
  lands in the squatter's account. That account is shadowed: it cannot activate invites or
  connect MCP. The owner links the password identity to their verified account (a move).
  The squatter's account is left with no identity. If the owner has no verified account
  yet, the squatter's account simply becomes theirs, with whatever the squatter put in it.
  Whether a squatter's refresh token survives the reset is not verified (below). S2 removes
  these cases.

## Delivery and tests

- One PR, no stack (feedback: clean delivery).
- **API tests** (per-file test databases, ADR-0025):
  - every row of the decision table, with signup on and off;
  - for tickets: expiry, reuse, wrong email, an unverified second identity (ticket kept),
    both identities mapped to verified accounts, neither mapped, the target gone;
  - moving off a shadowed account;
  - the verified-flag rule (a second verified flip is stored as false; the partial index
    holds under concurrent sign-ins);
  - removing the last method;
  - MCP resolving through a linked identity.
- **Web unit tests:** refusal states, Settings list, add and remove.
- **E2E (CI, Auth0):** a signed-in user sees "Sign-in methods" with one method and no
  "Remove". A full Google link in CI needs a Google test account. Whether to add one is
  [question 4](#questions-for-the-owner).
- **Docs in the same PR:**
  - `docs/AUTH0.md` replaces **Open** with the rules above;
  - a new ADR, "Several Auth0 identities per Wally account, linked in Wally", records option
    C and S1 (number after ADR-0027), with the ADR index **In production** cell;
  - `docs/SPEC.md` describes the Settings section.

## Questions for the owner

1. **C or B?** The recommendation is C: one extra sign-in, with live proof. B links
   automatically when both addresses are verified. B meets your minimum rule but not
   Auth0's advice.
2. **S2?** Should Wally delete accounts that stay unverified for N days (for example 30),
   with their boards? The same question covers shadowed accounts left with no identity
   after a move. The recommendation is not now. S1 removes the lockout, and deleting user
   data deserves its own decision. Until then those accounts stay in the database,
   unreachable.
3. **Different addresses?** Should a person be able to link a Google account whose address
   differs from their password account? The recommendation is not now. It changes which
   address invites match.
4. **Google in E2E?** Adding a dedicated Google test account to CI would let E2E prove the
   whole link. Without it, the full link is proven by API tests and one manual check by
   you in production.

## Left to the builder

- Ticket secret length and encoding, at least 128 bits of randomness.
- Exact route paths and DTO names, following the existing `/me` routes.
- How expired tickets are cleaned up.
- Settings layout, following the existing Settings sections.

## Evidence (checked 2026-11-03)

- Auth0 pricing, Free: "Account Linking" not available; Actions + Forms 5; M2M 1,000 —
  <https://auth0.com/pricing>
- Auth0 account linking overview: primary keeps its `user_id`; secondary metadata
  discarded; "request authentication for both accounts before linking occurs"; plan
  dependence — <https://auth0.com/docs/manage-users/user-accounts/user-account-linking>
- Auth0 SPA user-initiated linking: redirect with `connection`, link only "to a verified
  account" — <https://auth0.com/docs/manage-users/user-accounts/user-account-linking/user-initiated-account-linking-client-side-implementation>
- Management API link endpoint, scopes `update:users` / `update:current_user_identities` —
  <https://auth0.com/docs/api/management/v2/users/post-identities>
- Post Login API, `setPrimaryUser` —
  <https://auth0.com/docs/customize/actions/explore-triggers/signup-and-login-triggers/login-trigger/post-login-api-object>
- Auth0 user IDs, `{identity provider id}|{unique id in the provider}` —
  <https://auth0.com/docs/manage-users/user-accounts/identify-users>
- Auth0 email verification: social providers may overwrite `email_verified`; email is not
  proof of identity — <https://auth0.com/docs/manage-users/user-accounts/verify-emails>
- Google OpenID Connect: `email_verified`; use `sub`, not `email`, as the identifier —
  <https://developers.google.com/identity/openid-connect/openid-connect>
- OpenID Connect Core 1.0 §3.1.2.1, `prompt=login` —
  <https://openid.net/specs/openid-connect-core-1_0.html#AuthRequest>
- auth0-spa-js `RedirectLoginOptions.appState` —
  <https://auth0.github.io/auth0-spa-js/interfaces/RedirectLoginOptions.html>
- Sudhodanan and Paverd, "Pre-hijacked accounts", USENIX Security 2022 —
  <https://www.usenix.org/conference/usenixsecurity22/presentation/sudhodanan>

## Not verified first-hand

- That Drizzle's `uniqueIndex().where(…)` emits a partial unique index. Drizzle's page shows
  `.where()` only on `index()`
  ([indexes](https://orm.drizzle.team/docs/indexes-constraints)). If it does not, the
  migration creates the index in SQL.
- Where exactly auth0-spa-js stores `appState` across the redirect. It is browser storage,
  as the reviewer read from the SDK, but no SDK page was checked.

- Whether the Management API link endpoint works, or is refused, on a Free tenant. Option A
  is rejected, so this was not tested.
- That a self-service password reset sets `email_verified` to true. Auth0's support article
  says so ([support](https://support.auth0.com/center/s/article/Reseting-Password-sets-Email-Verified-to-True-but-Does-Not-Send-a-Welcome-Email)),
  but the main docs do not.
- That a database connection refuses a second signup with an address it already holds. This
  is widely relied on, but no Auth0 page was checked for it today.
- Whether Auth0 revokes existing refresh tokens when a password is reset. It matters for the
  pre-hijacking note.
- That Google's `email_verified` is true for every Google account with a non-Gmail address.
  Google's page defines the claim but does not say how it verifies such addresses.
