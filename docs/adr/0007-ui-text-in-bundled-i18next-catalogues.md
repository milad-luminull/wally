# ADR-0007: UI text in bundled i18next catalogues, German by default, language on the profile

- **Status:** accepted
- **Date:** 2026-09-20
- **Deciders:** Milad Rezazadeh

## Context and problem statement

Wally's domain language is German: horizons are HEUTE, DIESE_WOCHE and SPAETER, priorities HOCH, MITTEL and NIEDRIG. The UI must be available in German and English, German being the default, and a user's choice must follow them across devices ([`SPEC.md`](../SPEC.md), section 12). The first build had German strings inline in components. How are translations stored, chosen and kept complete?

## Considered options

1. **i18next with both catalogues bundled, a custom start-up detector, and the chosen language stored on the user profile:** good, because `t` is usable synchronously on first render and the choice survives sign-out and a new device; bad, because every language ships in every bundle.
2. **Catalogues loaded over HTTP per language:** good, because smaller initial bundle; bad, because a Suspense boundary or a loading state on every screen, for two small catalogues.
3. **Browser-only detection with `i18next-browser-languagedetector` and localStorage, no profile field:** good, because no API change; bad, because the choice does not follow the user, and the detector's precedence order is not the one we want.

## Decision outcome

Chosen option: **bundled catalogues, language on the profile.**

- [`apps/web/src/i18n/`](../../apps/web/src/i18n/) holds the runtime. `de.ts` is the key authority; `resources.test.ts` fails if `en.ts` drifts from its key set. `noHardcodedCopy.test.ts` fails the build if a component contains user-facing copy; it replaces a lint rule so no dependency was added.
- Keys are English and name the string's role (`.label`, `.aria`, `.body`), never its content. Anything held in React state is a key and is translated at render, or it goes stale on a language switch.
- Enum values stay in `@wally/shared`; their labels live only in the web catalogues (commit `619886b4`). API error messages stay English and are translated by `error` code in the browser.
- The start-up locale is this device's stored choice, then `navigator.languages`, then German (`detectInitialLocale` in `detect.ts`). Once the profile loads, its `language` outranks all of it and is mirrored back to storage so the next visit starts right.
- The API stores `language` on `users/{uid}` as a lowercase BCP 47 tag, seeds it from `Accept-Language` only when creating the record (`languageFromAcceptLanguage` in [`apps/api/src/lib/language.ts`](../../apps/api/src/lib/language.ts)), and changes it only through `PATCH /me`. The initial board name is seeded in the same language.

### Consequences

- Good: no flash of the wrong language on the second visit, and no loading state for text.
- Good: a missing key is a failing test, not a blank label in production.
- Bad: both catalogues are in the bundle. At two languages this is small; a fifth language would reopen option 2.
- Bad: adding a language touches `languageValues` in `@wally/shared`, both catalogues and the account menu.
- Neutral: the API cannot localise anything itself. If it ever has to send user-facing text (mail, for instance), it will need its own catalogue.

### Confirmation

`resources.test.ts`, `noHardcodedCopy.test.ts` and `englishSurface.test.tsx` run in CI.

## More information

- The i18n conventions for day-to-day work: [`SETUP.md`](../SETUP.md), "Frontend".
- Voice and the rules for how the app speaks: [`BRAND.md`](../BRAND.md).
