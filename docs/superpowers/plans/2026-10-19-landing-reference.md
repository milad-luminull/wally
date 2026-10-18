# Wally Landing reference implementation plan

> **For agentic workers:** Implement inline with superpowers:executing-plans; review the finished branch with superpowers:requesting-code-review.

**Goal:** Replace the current root landing page with the user's `../wally-design/Wally Landing.dc.html`, preserving the palette/appearance/language settings and authenticated navigation.

**Architecture:** React components reproduce the reference's layout and local interactive demonstrations. Existing theme tokens supply every colour; existing auth status supplies CTA destinations. Demo state is separate from board data and never invokes a microphone or backend.

**Tech Stack:** React 19, TypeScript, existing shadcn/Radix primitives, CSS variables, react-i18next, Vitest and Playwright. No dependencies.

**Spec:** User request dated 2026-10-19 and `../wally-design/Wally Landing.dc.html`.

## Requirements

- [x] Match header, animated hero/Wallybot, typography, floating notes, how-it-works cards, voice preview, five view previews, control cards, closing CTA, FAQ and footer.
- [x] Replace waitlist UI with actual signup/login navigation; authenticated CTAs open `/boards`; loading does not flash login/signup.
- [x] Preserve all nine palettes with light/dark/system and language selection; translate the new copy to German.
- [x] Demo input, voice example, Keep/Undo, view tabs, bot greeting and FAQs work locally; distinguish examples from real saved notes.
- [x] Responsive phone/tablet/desktop layout, keyboard access, animation pause/reduced-motion support and timer cleanup.
- [x] Keep existing login/signup screens and board behavior intact.
- [x] Visually compare reference and implementation and run frontend checks.
- [ ] Open follow-up PR and read CI.

## Review focus

- Changing language while a demo runs must translate derived labels without losing user-entered text.
- Auth loading and resolution must choose correct destinations without redirecting the public root.
- Narrow screens and long input must not cause document overflow.
- Pause/reduced-motion must prevent background cycling; typing must not be overwritten by autoplay.
- Repeated demo clicks, Keep/Undo and unmount must not leave stale timers or write real notes.

## Task 1: Landing replacement

Files: `routes/WelcomePage.tsx`, `features/landing/*`, `components/PublicHeader.tsx`, `styles/welcome.css`, `styles/landing.css`, `i18n/{en,de}.ts`, `routes/HomePage.test.tsx`, `e2e/{auth,appearance}.spec.ts`.

- [x] Update auth/navigation tests for the supplied headline. Add behavioral tests for view switching, FAQ toggling, demo input/Keep/Undo and paused animation.
- [x] Run focused tests to observe the missing reference layout/interactions.
- [x] Port the reference into focused components with local demo state. Scope landing styles, preserve shared auth styles, and map colours to semantic variables.
- [x] Add English/German catalogue entries and update old E2E headline assertions.
- [x] Run focused tests, typecheck and lint; resolve failures.

## Task 2: Visual verification and delivery

- [x] Compare desktop against the supplied HTML; inspect phone layout and dark appearance, switch palettes, verify auth navigation and demo interactions.
- [x] Run all frontend tests, build, lint, format and diff checks.
- [x] Review whole branch and resolve actionable findings.
- [ ] Commit, push, create and attach a PR against main; verify CI results before calling it ready.

## Verification evidence

- Frontend: 83 files, 689 tests passed. Typecheck, lint (eight pre-existing warnings), production build and repository formatting passed.
- Browser: desktop reference comparison; Paper Wall light/dark; English at 390px and German at 320px; header and review controls fit without page overflow.
- Review: fixed paused entrance animations that hid newly revealed steps; verified all three step opacities are 1 while paused.
- Stabilized the existing Tidy test clock at the fixture date (2026-10-17). Running it on 2026-10-19 changed the expected horizon and failed independently of this landing work; all 34 Tidy tests now pass.
- Public E2E coverage checks nine palettes in both appearances, persisted language, narrow German layout, FAQ/view switching, paused suggestions and auth routes. CI execution pending.
