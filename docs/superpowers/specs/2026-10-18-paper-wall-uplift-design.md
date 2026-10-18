# Wally Paper Wall visual uplift — iteration one

Status: builder review complete; awaiting owner scope approval. No product code changed.

## Intent and agreed scope

Use the local `../wally-design/Luminull Brand Research.dc.html` and `../wally-design/Wally Paper Wall v3.dc.html` as the visual references for Wally. Remodel the page layout and styling around the existing application; do not rebuild board behavior. The owner explicitly authorized a public landing page with login/signup entry points and configurable palette selection similar to language. The owner confirmed that **each palette must have both light and dark variants**.

Keep all existing board functionality. Any additional or removed functionality requires the owner's approval first. The reference is a visual source, not a product backlog.

## Visual direction

Paper Wall is the default palette. Use the existing self-hosted Geist and Geist Mono fonts. Adopt the reference's compact left navigation, broad quiet workspace, floating pill toolbar, softly elevated paper cards, restrained borders and rounded controls. Use the existing canvas pattern preference, so people who chose grid or no pattern keep that choice.

The board remains the dominant area. Colour primarily comes from notes and the selected accent; the surrounding interface stays quieter. No decorative marketing gradients inside the working board. Keep short metadata legible and preserve visible keyboard focus. Reference colours with insufficient text contrast get darker/lighter text variants rather than literal low-contrast copies.

Desktop arrangement:

```
┌───────────────────┬────────────────────────────────────────────┐
│ Wally             │ board title       search / filters / share │
│ Board switcher    │                   compact floating toolbar │
│                   ├────────────────────────────────────────────┤
│ List              │                                            │
│ Horizon           │        existing board or list surface      │
│ Priority          │                                            │
│ Whiteboard        │        selected note opens the existing    │
│                   │        detail panel at the right           │
│                   │                                            │
│ New note          │                                            │
│ Account/settings  │                                            │
└───────────────────┴────────────────────────────────────────────┘
```

The rail uses the current board switcher and existing view/axis setters. Its destinations are the existing List view and Horizon, Priority, and Free wall modes. List grouping and Reset view remain available through Display. Board rename, sharing, member controls, search, every filter, command palette, account settings and keyboard shortcuts remain reachable. This is a relocation of controls, not new navigation semantics.

On smaller screens retain today's list-only behavior and accessible top-bar/menu controls; do not compress the desktop rail into the content. Reuse existing responsive breakpoints. Keep touch targets at least 44px where appropriate. The board home and auth pages receive matching typography, surfaces, spacing and button treatment so the experience feels consistent.

Card styling may change padding, type hierarchy, borders, radii and shadows. Preserve card geometry constants where they govern drag/drop, link lines and collision placement. Changing styling must not move saved cards, alter stored coordinates, or obscure metadata, pending suggestions or editing controls. The detail panel receives the same surface/type treatment while retaining its fields and actions.

## Functionality that stays

- Board creation, switching, rename, deletion, sharing, membership and permissions.
- All current filters, list grouping, wall axes, reset-view and per-board preferences.
- Note capture, editing, dragging, duplication, completion, deletion with Undo, tags, custom fields, subtasks and history.
- Related-note navigation/counts/lines and current visibility rules.
- Wallybot Ask, suggestions, Tidy, Keep/Undo/Discard and the existing assistant switch/settings.
- Keyboard shortcuts, existing accessibility behavior, loading/error/empty states and mobile restrictions.
- Light / Dark / System, language, canvas pattern and account settings.

Do not add the prototype's Focus mode, inbox semantics, calendar, timers, Daily Plan, Weekly Plan, Daily Shutdown, new global composer, new AI workflows, pricing, waitlist, newsletter, or cross-board aggregation. Do not replace existing behaviors with the prototype's simulated handlers. No domain/deployment changes.

## Public landing page and authentication

Serve the marketing landing page at `/` for signed-out visitors, on the existing app host. Signed-in visitors keep the current home resolver: accepted return destinations, the single-board shortcut and the boards home. Keep `/login`, `/signup`, protected board URLs and share redemption working, including return-path validation and account isolation.

The landing page presents **Wally by Luminull**. Use a strong, concise heading about getting thoughts onto one wall, a product illustration made from representative note cards, primary Sign up and secondary Log in actions, and a short section showing existing capture, organise and review workflows. Repeat the signup action at the end. The illustration is clearly sample content and does not call the assistant or create data. No fabricated testimonials, prices, integrations, guarantees or claims that AI changes always need approval; describe the actual review/undo behavior.

Both English and German copy ship in the existing catalogue. Offer language, palette and appearance controls before login. Login and signup keep their current validation and providers, with matching visual styling and a link back to the public home. Loading auth must not flash the signed-out landing page to an authenticated user.

## Palette and token system

Palette and appearance are independent preferences. Appearance remains `light | dark | system`; System resolves the OS preference within the chosen palette. Supply these palettes from the references:

| Palette              | Source anchor colours                                | Reference               |
| -------------------- | ---------------------------------------------------- | ----------------------- |
| Paper Wall (default) | #FFFFFF, #F6F6F5, #111111, #F5A524, #FFE27A, #BDE5FF | Paper Wall v3           |
| Clear Morning        | #EEF6FC, #0B1A2A, #FFD05C, #D9F5E6                   | Both                    |
| Highlighter          | #FFFFFF, #111111, #EDFF4A                            | Both                    |
| Aurora               | #0B0B12, #5EEAD4, #FDE68A, #FDA4AF                   | Both                    |
| Daybreak             | #FFFFFF, #FFF1E8, #FFC53D, #FF6B3D, #14110F          | Both                    |
| Sprout               | #F6FBEA, #C6F432, #2F7D57, #0F2A1F                   | Both                    |
| Amber Poster         | #FFF6DD, #FFD36B, #FFB21A, #FF5B2E, #111111          | Brand Research          |
| Neutral              | #FFFFFF, #F5F5F5, #0A0A0A                            | Brand Research baseline |

The supplied light palettes need authored dark companions, and Aurora needs a light companion. Keep each palette's hue identity. The reference values guide the result, but accessible contrast takes precedence. Do not infer “Aurora means dark” when the user selected Light.

Use one configurable palette definition layer mapped into existing semantic CSS variables: canvas, rail, surfaces, inset/hover, text hierarchy, borders, primary/accent and their text colours, selection/focus, shadows, status colours and note fills. Components consume semantic tokens rather than embedded palette hex values. Existing 14 note colour choices and stored colour identifiers stay intact; map their displayed shades through tokens while keeping their recognizable colour families and status meaning. Never rewrite note data to change a palette.

Add a named palette selector with swatch previews beside appearance/language in account settings, and reuse it for signed-out pages. Selecting a palette applies immediately. Save it on the profile using the current debounced preference flow and mirror it locally for first paint and signed-out use. Existing accounts default to Paper Wall without a data migration. Validate palette IDs on both client and API, preserve unrelated preferences on patch, and use Paper Wall for missing/unknown local values. When the profile loads, it is authoritative as with current theme behavior. Preserve existing preference failure/recovery behavior.

## Builder decisions and boundaries

Use the existing React, TypeScript, Tailwind, Radix, React Query and Firebase stack; no UI framework replacement or external font service. Extract presentation components as needed, while retaining existing state hooks and mutation paths. The exact rail width (approximately 212–224px), spacing, responsive arrangement and authored companion colour values are implementation choices to be checked visually against the references.

This iteration does not add sidebar collapse/resize persistence, change card positions, repair old overlapping layouts, or change the engine behind the wall. Any necessary product change beyond the two authorized additions (landing page and palette preference) returns to the owner first.

## Verification and completion

- Regression coverage for landing/auth redirects and protected share/board return paths.
- Preference tests for defaults, invalid IDs, palette plus theme persistence, first paint, session/account changes, and unrelated preference preservation. Run emulator test files sequentially, using isolated test projects.
- Preserve existing board/keyboard/permissions tests; adapt queries only when presentation changes legitimately alter the UI.
- Visual checks of landing, auth, board home, list, each wall mode and note detail on desktop and mobile, including representative long German text and empty/loading/error states.
- Check all palette/light-dark combinations for text, control and focus contrast; inspect representative screenshots and ensure no clipped controls, overlapping toolbars or inaccessible dialogs.
- Typecheck, lint, formatting, builds, appropriate automated tests and actual full-stack CI before ready.
- Work only in the isolated checkout. Never switch the live `/Users/mr_user/development/apps/wally` branch, run `docker compose down`, remove volumes or clear the user's emulator data.
- Deliver a PR with screenshots and validation. Merging, release tags and production deployment remain owner actions unless explicitly requested.
