# Paper Wall Uplift Implementation Plan

> **Status:** executed in PR #60.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Apply the approved Paper Wall layout, public landing page and nine configurable light/dark palettes while retaining current behavior and Minimal's original colours.
**Architecture:** Extend the existing profile preferences and CSS token contract; keep all board state/mutations. A desktop rail composes existing navigation, and the public root dispatches to marketing or the unchanged authenticated home resolver.
**Tech Stack:** React, TypeScript, Tailwind, Radix, React Query, Firebase, Vitest, Playwright.
**Spec:** docs/superpowers/specs/2026-10-18-paper-wall-uplift-design.md

## Global Constraints

- Current theme is available as Minimal with its original light/dark tokens. Paper Wall is default.
- Every palette supports light, dark and OS-resolved System; selection persists like other preferences.
- Preserve all 14 note colour identities and all board functions, permissions and state hooks.
- No prototype-only features, framework replacement, external fonts, domain changes or deployment.
- Isolated checkout only; no live branch changes, compose down, emulator resets or concurrent emulator files.
- English and German, accessible focus/contrast, current mobile list-only behavior.

## Review Focus

- Older profiles and unknown local palette values retain unrelated settings and fall back safely (Task 1/2).
- A palette chosen before login must not overwrite another account's saved choice (Task 2).
- A loading auth state and share-link return destinations must not get lost through public root (Task 3).
- Long translated text and a narrow desktop window must not hide controls or change canvas coordinates (Task 4/5).
- All light/dark palette pairs need readable note metadata, status text and focus (Task 2/5).

### Task 1: Palette preference contract

**Files:** packages/shared/src/enums.ts, packages/shared/src/schemas/me.ts; apps/api/src/routes/me.ts, apps/api/src/lib/db/collections.ts; apps/api/test/me.test.ts; apps/web/src/lib/preferences.ts, preferences.test.ts.
**Interfaces:** export paletteValues, paletteSchema, Palette; Preferences.palette and optional PreferencesUpdate.palette. IDs: minimal, paper, morning, highlighter, aurora, daybreak, sprout, amber, neutral. Default paper.

- [ ] Add tests: applying `{palette:'minimal'}` retains theme, boards and Wallybot; schema refuses unknown palette; GET old profile defaults paper; PATCH palette preserves language/theme/board preferences.
- [ ] Run focused preference/API tests and observe failures.
- [ ] Add enum/default, safe persisted preference parsing and dotted-path patch. Keep preferences private to /me.
- [ ] Build shared; run web preference tests and one isolated API me test file sequentially. Expected pass.
- [ ] Commit preference contract.

### Task 2: Token palettes and appearance controls

**Files:** create apps/web/src/lib/palettes.ts, palettes.test.ts, theme.test.tsx, components/AppearanceControls.tsx; modify lib/theme.tsx, index.html, styles/globals.css; create styles/palettes.css; modify features/board/AccountMenu.tsx and i18n catalogues.
**Interfaces:** PALETTES metadata keyed by Palette; useTheme() adds palette and setPalette(Palette), retaining theme/resolved/setTheme. AppearanceControls exposes the shared palette and appearance inputs, with localized labels.

- [ ] Tests assert nine palette IDs; unknown storage falls back paper; profile selection wins on account changes; local and profile selections work independently of appearance; Minimal resolves original token values. Check key text/accent/note contrast for all variants.
- [ ] Run tests RED, then implement palette metadata, semantic token overrides and provider persistence. Keep original :root/.dark token definitions as Minimal; add overrides through data-palette for the other eight.
- [ ] Apply validated data-palette before first paint; browser theme-color follows computed canvas. Authenticated settings save through existing preference queue; public controls use local preference.
- [ ] Replace only appearance block in AccountMenu with shared controls; add localized labels and swatch previews. Preserve other settings.
- [ ] Run focused provider/account/contrast tests, typecheck. Expected pass. Commit.

### Task 3: Public landing and consistent auth presentation

**Files:** create routes/HomePage.tsx, HomePage.test.tsx, WelcomePage.tsx; components/PublicHeader.tsx; styles/welcome.css; modify App.tsx, routes/AuthLayout.tsx and catalogues.
**Interfaces:** HomePage dispatches loading -> AppSkeleton, authenticated -> existing LandingPage resolver, signed-out -> WelcomePage. PublicHeader uses existing language plus AppearanceControls. Existing auth forms unchanged.

- [ ] Tests: signed-out root exposes signup/login links; authenticated root preserves resolver; loading does not render marketing; signup/login links keep existing paths. Existing LandingPage tests continue proving return-path checks.
- [ ] Run RED; implement public route and responsive marketing page: Wally by Luminull, representative sample-note composition, capture/organise/review narrative, signup CTA. No API demo, invented claims or extra features.
- [ ] Style auth with shared public header and theme tokens, preserving form and redirect logic.
- [ ] Run HomePage, LandingPage, login and share route tests. Expected pass. Commit.

### Task 4: Board shell and surface uplift

**Files:** create features/board/BoardRail.tsx and BoardRail.test.tsx, styles/board-shell.css; modify AppShell.tsx, TopBar.tsx, FilterBar.tsx, NoteCard.tsx, NoteDetailPanel.tsx, routes/BoardsPage.tsx and shared styles as needed.
**Interfaces:** BoardRail consumes boardId, effective view/axis, current view/axis setters, onNewNote and visibility; all actions remain existing callbacks. TopBar accepts rail mode for hiding only relocated controls.

- [ ] Tests prove rail links call the existing view/axis callbacks, private-note action label remains correct, and account/board switching/new note remain reachable. Existing TopBar tests preserve rename/share/display behavior.
- [ ] Run RED. Add 216px desktop rail (existing desktop breakpoint), desktop floating toolbar and quieter filter surface. Keep responsive list-only topbar on small screens. Retain Display menu for list grouping/reset and every filter.
- [ ] Apply reference-inspired paper radius/shadows/typography through CSS without changing card geometry, drag/drop, position, AI, selection, link or detail state code. Match board home.
- [ ] Run rail/topbar/filter/board page/card/detail/command tests. Expected pass. Commit.

### Task 5: Visual verification and integration

**Files:** docs/BRAND.md and relevant docs; e2e only if required to cover new public/palette behavior.
**Interfaces:** consumes all prior tasks; deliver screenshots, reviewed branch and CI-ready PR.

- [ ] Check all nine palettes in both modes. Check desktop/mobile public page, login/signup, board home, list, horizon, priority, free wall and detail. Check long German labels and open menus for overflow; retain all current functions.
- [ ] Run web suite, API affected files sequentially, typecheck/lint/format/build. Expected all pass (existing lint warnings recorded).
- [ ] Fresh whole-branch review, one fix wave with reproductions for important findings; update docs and ledger.
- [ ] Push feature branch, open one PR, attach it, inspect full-stack CI before ready. No merge or deployment.
