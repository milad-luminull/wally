# ADR-0004: Firebase ID tokens verified by the API; user and board provisioned on the first request

- **Status:** accepted
- **Date:** 2026-09-18
- **Deciders:** Milad Rezazadeh

## Context and problem statement

Wally is a standalone application with no corporate directory and no single sign-on requirement ([`SPEC.md`](../SPEC.md), section 13). It needs sign-in with email and password and with Google, and it needs to know, on every request, who is calling and what role they hold on a whiteboard. How does the API establish identity, and when does a user record come into existence?

## Considered options

1. **Firebase Authentication in the browser, ID token verified by the API on every request, user and board created on the first authenticated call:** good, because sign-in flows, password reset and Google are off the shelf and the API has no signup endpoint; bad, because every request pays for a token verification and a user transaction.
2. **Sessions and password hashes owned by the API:** good, because no third party in the auth path; bad, because the project would own password storage, reset mails and Google OAuth, all of which Firebase already does.
3. **Firebase Authentication with a Cloud Function on user creation that writes the profile:** good, because the API's request path stays read-only for the profile; bad, because a second deployable with its own IAM, and a user who signs in before the function has run would 404.

## Decision outcome

Chosen option: **Firebase ID tokens verified by the API, with lazy provisioning.**

- A global `preHandler` in [`apps/api/src/plugins/auth.ts`](../../apps/api/src/plugins/auth.ts) verifies the bearer token on every route except `/health`.
- `provisionUser` writes the user record and the user's own whiteboard in one transaction. The board's document id is the owner's uid, so "one whiteboard per owner" is a property of the key space rather than a constraint to enforce.
- Permissions are Wally's own. `resolveRole` in [`apps/api/src/lib/authorization.ts`](../../apps/api/src/lib/authorization.ts) answers OWNER, EDIT or VIEW from the board document's `memberRoles` map. "Does not exist" and "no access" both return 404 so a caller cannot probe for board ids.
- An invite addressed to an email is activated automatically only when the ID token says the email is verified (`emailVerified` on `UserDoc`; commit `95e83782`). Firebase permits sign-up with someone else's address.
- The Admin SDK is initialised in one of three modes in [`apps/api/src/lib/firebase-app.ts`](../../apps/api/src/lib/firebase-app.ts): a service-account key, application default credentials on Cloud Run, or no credential for the emulator. `loadEnv` refuses to boot a production process that points at an emulator.

### Consequences

- Good: no password storage, no reset mails, no OAuth client code in this repository.
- Good: a new identity cannot end up with a user record and no board, or two boards.
- Bad: each request costs a token verification plus a Firestore transaction on the user document. The invite sweep is a collection-group query and is only run when the user record changes.
- Bad: Firebase Auth is not emulated, so local development and CI need a real Firebase project and real test credentials (ADR-0009).
- Neutral: the email on the user record is a copy of the token's claim and is always stored lowercase.

### Confirmation

`apps/api/test/auth.test.ts` and `apps/api/test/invite-security.test.ts` run against the emulator with a fake verifier injected through `buildApp` in [`apps/api/src/app.ts`](../../apps/api/src/app.ts).

## More information

- Role rules and the data each role may see: [`GDPR.md`](../GDPR.md), section 3.
- The credential modes in operation: [`DEPLOY.md`](../DEPLOY.md), section 5.
