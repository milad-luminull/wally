# Passkeys with password fallback, Google kept, one identity per account — design

> **Status:** approved by the owner, 2026-11-03. It replaces the same day's account-linking
> design, which the owner dropped: Wally builds no account linking. Code: steps 2–4. The
> docs in step 5 wait for the `docs/keep-auth0` work to land.

## Intent

The owner's direction (2026-11-03):

- Auth0 Free stays the only identity provider.
- **Google stays the main signup.**
- The Auth0 database connection adds **passkeys**, with password as the fallback.
- **Each Wally account has exactly one Auth0 identity.** Wally builds no linking and no
  merging, and does no custom authentication.
- Keep what works, keep existing users and data, and do not touch the Firebase-to-Supabase
  migration.

## Starting point (checked 2026-11-03)

- **Connections.** Auth0 has two: `google-oauth2` and `Username-Password-Authentication`.
  Both are domain-level, so the SPA and the ChatGPT MCP client can use them
  ([AUTH0.md](../../AUTH0.md)). Sign-in happens on Auth0's hosted page. Wally's code
  references no connection: `GoogleMark.tsx` is unused, and only the
  `auth.hosted.description` string mentions Google.
- **Production data.** There are 2 users, each with exactly one identity, and both
  identities are `google-oauth2`. Both addresses are stored as verified. No password user
  exists. (Read-only count, Supabase project `wally`.)
- **Identity code already does "one identity per account".** `resolveOrCreateIdentity`
  ([identities.ts](../../../apps/api/src/lib/auth/identities.ts)) creates the account at
  the first sign-in. A second identity with an address that an account already holds gets
  `403 IDENTITY_NOT_LINKED`, and no account is created. This stays.
- **The weakness to fix: squatting.** A password signup does not need a verified address.
  Today the API creates its Wally account anyway, and the address is then held. Later, the
  real owner signing up with Google is refused.
- **CI E2E** signs in as two dedicated database users (`+1` for normal runs, `+2` for
  Dependabot). Their passwords were set by an administrator, without an inbox. The helper
  `apps/web/e2e/support.ts` fills email and password on one screen.
- **In-flight work that overlaps.** The uncommitted `docs/keep-auth0` work rewrites
  `docs/AUTH0.md`, `docs/SPEC.md`, ADR-0016 and the ADR index, and adds ADR-0027
  (Supabase trusts Auth0 ID tokens; one `sub` per user fits it as is). This design's doc
  edits go on top of that work, after it lands.

## What Auth0 Free provides (checked 2026-11-03)

| Need                                 | Auth0 Free                                                                                                                                                                        | Source                                                                                                                                                                                                                                                                                              |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Passkeys                             | "Passkeys": Included on every plan, Free too                                                                                                                                      | [pricing](https://auth0.com/pricing)                                                                                                                                                                                                                                                                |
| Password fallback                    | "Database connections with passkeys enabled must also still have passwords enabled." Passkeys "do not replace" existing credentials                                               | [passkey policy](https://auth0.com/docs/authenticate/database-connections/passkeys/configure-passkey-policy), [passkeys](https://auth0.com/docs/authenticate/database-connections/passkeys)                                                                                                         |
| Existing password users get passkeys | Progressive enrollment is on by default: it prompts after a password login, and users can postpone it for 30 days                                                                 | [passkey policy](https://auth0.com/docs/authenticate/database-connections/passkeys/configure-passkey-policy)                                                                                                                                                                                        |
| Prerequisites                        | Universal Login, Identifier First, no custom login page, "Requires Username" off, no custom database. A custom domain is advised before enabling (Wally has `login.luminull.com`) | [passkey policy](https://auth0.com/docs/authenticate/database-connections/passkeys/configure-passkey-policy)                                                                                                                                                                                        |
| Identifier First                     | Dashboard > Authentication > Authentication Profile. Works only with the New Universal Login Experience                                                                           | [Identifier First](https://auth0.com/docs/authenticate/login/auth0-universal-login/identifier-first)                                                                                                                                                                                                |
| Refusing unverified sign-ins         | Post Login Actions (5 on Free; Wally uses 1). `api.access.deny` stops the login. The trigger also runs "when a Refresh Token … is exchanged"                                      | [pricing](https://auth0.com/pricing), [post-login API](https://auth0.com/docs/customize/actions/explore-triggers/signup-and-login-triggers/login-trigger/post-login-api-object), [login trigger](https://auth0.com/docs/customize/actions/explore-triggers/signup-and-login-triggers/login-trigger) |

Passkeys belong to the database connection only. A Google user signs in with Google, and
whether they use a passkey there is Google's business, not Wally's.

## Design

1. **Auth0 tenant (owner, in the dashboard):**
   - confirm the New Universal Login Experience and no custom login page;
   - set the Authentication Profile to Identifier First;
   - turn "Requires Username" off on `Username-Password-Authentication` if it is on;
   - enable passkeys there with progressive enrollment;
   - keep `google-oauth2` exactly as it is.
2. **No unverified sign-ins.** The versioned Post Login Action
   ([auth0-post-login.cjs](../../../infra/auth0-post-login.cjs)) first calls
   `api.access.deny` when `event.user.email_verified` is not true. The person verifies
   from Auth0's signup email, then signs in.
   - This fixes squatting at the source. An unverified signup never gets a token, so it
     never gets a refresh token either, and never a Wally account. The address stays free
     for its real owner.
   - It needs no Wally code. Google users and the two production users are already
     verified.
   - **Before** the Action changes, the owner marks the two CI accounts as verified in the
     Auth0 dashboard (user > email verified). Otherwise E2E would stop signing in.
3. **One identity per account, no linking.** The API stays as it is. A person who signed up
   with Google and later tries a passkey or password with the same address, or the reverse,
   is refused, and no second account is created. Only the copy changes:
   - `auth.hosted.migration` (en/de) becomes "This email address already has a Wally
     account. Sign in the way you signed up, for example with Google.";
   - `auth.hosted.description` becomes "Sign in with Google, a passkey or your email.";
   - `GoogleMark.tsx` stays: it is not in the way, and Google stays.
4. **CI E2E** (`apps/web/e2e/support.ts`):
   - Identifier First splits the login into two screens: email, then password. The helper
     fills them in turn;
   - after a password login, the helper postpones the progressive-enrollment prompt
     ("Remind me later" or similar; the exact label is read from the live page);
   - CI keeps testing the password path. A passkey cannot be entered from a CI login.
5. **Docs** (after `docs/keep-auth0` lands, in one PR with 3 and 4):
   - `docs/AUTH0.md`: the connections, passkeys, verified-only sign-in, and one identity per
     account. Its **Open** note is answered: no linking, by design;
   - `docs/SPEC.md` §auth line: "Google, passkeys or email and password";
   - a new ADR (the number after ADR-0027): "One Auth0 identity per Wally account; passkeys
     with password fallback on the database connection; Google kept", indexed with its
     **In production** cell.

   ADR-0016 stays as it is, because Google "remains the sign-in option" there as well. The
   new ADR records what ADR-0016 left open.

6. **Supabase.** Nothing changes. The API still maps `(issuer, subject)` to a user, and
   ADR-0027's policies key on `sub`, which stays one per account.

## Validation

- **CI:** API tests unchanged. E2E green with the new two-step login.
- **Owner, once in production after the tenant change:**
  1. sign in with Google (the existing account opens);
  2. sign up with a new address using a passkey, verify the email, sign in with the passkey;
  3. sign out, sign in with that address's password;
  4. try a Google-held address with a password signup (refused, with the new copy);
  5. an unverified signup is denied by Auth0.

## Trade-offs to accept

- **One method per address.** Someone who signed up with Google cannot later use a passkey
  or password with that address. The reverse holds too. That is what "no linking" means.
- **Verified-only.** New password or passkey users must verify their email before their
  first sign-in. Today an unverified user can use Wally with a banner. That banner
  (`EmailVerificationBanner`) then never shows. It stays in the code until a later cleanup.
- **Leftover Auth0 users.** An abandoned unverified signup stays an Auth0 database user.
  The real owner of that address can still sign up with Google. For a password signup they
  use "Forgot password", which also verifies the address (Auth0 support article; not in
  the main docs).

## Not verified first-hand

- That Wally's tenant already runs the New Universal Login Experience. It looks so from the
  `/u/consent` path the E2E helper waits for. The owner confirms it in the dashboard.
- The exact labels of Identifier First and the enrollment prompt on Wally's hosted page.
  They are read from the live page while the helper is written.
- That a password reset sets `email_verified`
  ([support article](https://support.auth0.com/center/s/article/Reseting-Password-sets-Email-Verified-to-True-but-Does-Not-Send-a-Welcome-Email)).
