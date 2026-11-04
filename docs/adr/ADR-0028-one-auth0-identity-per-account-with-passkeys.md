# ADR-0028: One Auth0 identity per Wally account, with passkeys and verified email

- **Status:** accepted
- **Date:** 2026-11-03
- **Deciders:** Milad Rezazadeh

## Context and problem statement

Auth0 is Wally's identity provider
([ADR-0016](ADR-0016-auth0-for-web-and-mcp.md)), with two connections: Google, the main
signup, and the database connection for email and password. Wally maps
`(issuer, subject)` to a user and refuses a second identity whose address an account
already holds. On 2026-11-01 the owner asked that one account be reachable through several
methods, and that an unverified password signup no longer hold an address its verified
owner then cannot use. Auth0's own Account Linking is not available on Free
([pricing](https://auth0.com/pricing)). Should Wally link identities, and how is the
address squatting closed?

## Decision drivers

- Auth0 Free only, nothing spent.
- No custom authentication, identity linking or account merging in Wally.
- Keep the two production accounts and every working sign-in.

## Considered options

1. **Link identities in Wally**, after a live sign-in with both. Good: one account, several
   methods. Bad: Wally owns link tickets, an extra auth boundary and edge cases. Designed and
   dropped by the owner on 2026-11-03.
2. **One identity per account, passkeys on the database connection, verified email
   required.** Good: no linking code; passkeys are included on Free. Bad: a person keeps
   the method they signed up with.
3. **Database connection only, Google removed.** Good: one connection. Bad: Google is the
   main signup, and both production accounts use it. Rejected by the owner.

## Decision outcome

Chosen option: **option 2**.

- **One identity per account.** A second method with an address that an account already
  holds is refused with `IDENTITY_NOT_LINKED`, and no account is created. Wally never links
  or merges. The refusal tells the person to sign in the way they signed up.
- **Google stays** exactly as configured.
- **Passkeys with password fallback** on `Username-Password-Authentication`. Passkeys are
  included on every plan ([pricing](https://auth0.com/pricing)). A connection with passkeys
  "must also still have passwords enabled", and progressive enrollment offers a passkey
  after a password login
  ([passkey policy](https://auth0.com/docs/authenticate/database-connections/passkeys/configure-passkey-policy)).
  This needs Identifier First on the New Universal Login
  ([Identifier First](https://auth0.com/docs/authenticate/login/auth0-universal-login/identifier-first)).
- **Verified email required.** The Post Login Action (`infra/auth0-post-login.cjs`) denies
  any login or refresh-token exchange whose `email_verified` is not `true`
  ([login trigger](https://auth0.com/docs/customize/actions/explore-triggers/signup-and-login-triggers/login-trigger)).
  An unverified signup never gets a token, so it never gets a Wally account and cannot
  hold an address.

### Consequences

- Good: no linking code. The `(issuer, subject)` mapping and ADR-0027's one `sub` per user
  stay as they are.
- Good: squatting is closed in Auth0, before Wally sees a token.
- Bad: a person who signed up with Google cannot later use a passkey or password with the
  same address, and the reverse holds too.
- Bad: new email signups must verify before their first sign-in. The web app's unverified
  banner (`EmailVerificationBanner`) no longer shows to anyone.
- Neutral: the tenant settings are changed by hand. The steps and their order are in
  [AUTH0.md](../AUTH0.md#sign-in-methods).

### Confirmation

- `scripts/auth0-post-login.test.mjs` covers the denial.
- CI E2E signs in through the hosted page, with Identifier First and the passkey prompt.
- After the tenant change, the owner checks once by hand: a Google sign-in, a passkey
  signup, a password sign-in, a refused second method, and a denied unverified signup.

## More information

- Design: [passkeys, one identity](../superpowers/specs/2026-11-03-passkeys-one-identity-design.md).
