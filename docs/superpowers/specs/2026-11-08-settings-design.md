# Settings — design

> **Status:** accepted 2026-11-08 (plan: [2026-11-08-settings.md](../plans/2026-11-08-settings.md)).

## Intent

Today a signed-in person's settings are spread over three places that look different:

- **The profile popover** (the avatar in the board rail, the board top bar and the board-home
  header, [AccountMenu.tsx](../../../apps/web/src/features/board/AccountMenu.tsx)) holds the
  colour palette, light/dark mode, the free canvas background, the language, the Wallybot
  switch, keyboard shortcuts, links to Connected apps and Account and data, and Sign out. It
  is 288px wide and scrolls, and none of it is called "Settings".
- **`/settings/connections` and `/settings/account`** sit in the board-home chrome
  ([HomeShell.tsx](../../../apps/web/src/features/boards/HomeShell.tsx)): a top header and a
  centred column, unlike the board's left rail.
- **Both pages' back link is hard-coded to `/boards`**, so someone who opened Settings from a
  board loses their place.

The owner wants one Settings area that looks like the board: menu on the left, the chosen view
on the right; a clear Settings entry in the rail and in the profile card; short copy that
explains each setting without over-explaining; and Back that returns to the previous view.

## Goals

- One Settings area with a left rail in the board rail's visual language and the chosen
  section on the right.
- A visible **Settings** entry in the board rail and in the profile popover.
- **Back** returns to the page the person opened Settings from.
- Every section has a short sidebar label and one plain line under its title; individual
  controls get a hint only where the label is not enough.
- Works on phones: a section list, then the section full width.

## Non-goals

- No new settings, no new API, no change to how preferences are stored.
- No change to the public landing page's own appearance and language menu (signed-out
  visitors).
- Keyboard shortcuts do not become a settings page; their help needs a board's command layer.
- The Settings rail does not collapse.

## Anti-goals

- Settings that look like a different app from the board.
- Back that dumps the person on Boards after they came from a board.
- Copy that reads like a manual: no paragraph where one line does.
- Breaking the existing addresses `/settings/account` and `/settings/connections`, which E2E
  specs, the deletion flow and possibly bookmarks use.

## Decided

### Sections and addresses

| Address | Sidebar label | Line under the title | Contents (moved from) |
|---|---|---|---|
| `/settings/appearance` | Appearance | Colours, light or dark, and the canvas background. | Colour palette, mode, free canvas background (popover) |
| `/settings/language` | Language | The language Wally uses. | Language select with its saving / save-failed status (popover) |
| `/settings/wallybot` | Wallybot | Whether suggestions apply on their own or wait for you. | The "Always ask me" switch (popover) |
| `/settings/connections` | Connected apps | Let ChatGPT, Claude or other AI apps use your boards. | Today's Connections page |
| `/settings/account` | Account and data | Download your data or delete your account. | Today's Account and data page, with the Privacy and Terms links |

- `/settings` on a wide screen redirects (replace) to `/settings/appearance`; on a narrow
  screen it shows the section list (below).
- An unknown `/settings/<x>` redirects to `/settings`.
- All settings routes stay behind `ProtectedRoute`.
- German copy is written alongside the English for every new and changed string, in
  `i18n/en.ts` and `i18n/de.ts`.

### Layout (wide screens, the board's desktop breakpoint, 1080px and up)

```
┌────────────────────┬──────────────────────────────────────┐
│ ← Back             │  Appearance                          │
│ Settings           │  Colours, light or dark, and the     │
│                    │  canvas background.                  │
│ ◐ Appearance     ● │                                      │
│ 文 Language        │  Colour palette   [ Minimal      ▾ ] │
│ ✦ Wallybot         │  Mode             [System|Light|Dark]│
│ ⇄ Connected apps   │  Canvas           [Dots|Grid|Plain]  │
│ ⊙ Account and data │                                      │
│                    │                                      │
│ ┌────────────────┐ │                                      │
│ │ (MR) Name      │ │                                      │
│ │ email          │ │                                      │
│ └────────────────┘ │                                      │
│ ⏻ Sign out         │                                      │
└────────────────────┴──────────────────────────────────────┘
```

- **Rail:** same width (212px), background (`--rail` / `--inset`), padding, item height,
  hover and `aria-current` styling as `.board-rail` / `.board-rail-nav` in
  [board-shell.css](../../../apps/web/src/styles/board-shell.css). Reuse those classes or
  extract shared ones; do not fork the look.
- **Rail top:** a "← Back" control, then the heading "Settings".
- **Rail nav:** the five sections, each an icon and a label, as links; the current one has
  `aria-current="page"`. It is a `<nav>` with an accessible name ("Settings").
- **Rail bottom:** the user card (avatar, name, email; not a menu here) and Sign out.
- **Content:** an `h1` with the section title, the one-line description under it, then the
  controls. A readable column (today's `max-w-3xl` or narrower), left-aligned beside the rail.
  The content area scrolls on its own; the rail stays put.
- The email-verification banner stays at the top, as in the other shells.

### Narrow screens (below 1080px)

- `/settings` shows "← Back", the heading "Settings", the five sections as a full-width list
  (label plus its one line), then the user card and Sign out.
- A section opens full width with "← Settings" at the top, which returns to the list.
- No horizontal page scroll at 320px.

### Ways in

- **Board rail:** a **Settings** item with a gear icon at the rail bottom, directly above the
  user card, styled like the rail's nav items, with a tooltip when the rail is collapsed.
- **Profile popover** (rail, top bar and board-home header), slimmed to:
  1. name and email,
  2. **Mode** — the System / Light / Dark switch (the owner chose to keep it here),
  3. **Settings** (gear icon) — the first menu item,
  4. Keyboard shortcuts (only where a board is mounted, as today),
  5. Sign out.
  Palette, canvas background, language, Wallybot and the two settings links leave the popover.
  Mode is in both the popover and Appearance; both read and write the same theme state.
- **Command palette** ([BoardCommands.tsx](../../../apps/web/src/features/board/BoardCommands.tsx)):
  its existing "Settings" group keeps its quick commands and gains one **Open settings**
  command that goes to `/settings` with the board as origin. *(Builder's call, approved with
  this doc.)*
- `AppearanceControls` is also used by the signed-out landing page
  ([PublicHeader.tsx](../../../apps/web/src/components/PublicHeader.tsx)). Splitting Mode out
  for the popover must leave the landing page exactly as it is.

### Back

- Every way into Settings passes the page it came from (path, search and hash) in router
  location state.
- Moving between sections uses `replace` and carries the same origin forward, so one Back —
  the control or the browser's — leaves Settings.
- "← Back" goes to that origin. With no origin (a typed URL, a bookmark, a reload that lost
  state), it goes to `/boards`.
- On narrow screens, opening a section from the list is a normal push, so the browser's back
  returns to the list, and "← Settings" does the same.
- The account-deletion flow keeps its own behaviour after deletion.
- Back restores the board's view (axis, filters, search, open note), since those live in the
  URL or saved preferences. The board rail's collapsed state is component state today and
  comes back expanded; that stays as it is, because remembering it would need new storage.
  *(Builder's call, approved with this doc.)*

### Visual spec

The brief sets the direction: Settings must look like the board, in the Paper Wall language
([BRAND.md](../../BRAND.md)). Nothing new is invented. Every value below either comes from
[board-shell.css](../../../apps/web/src/styles/board-shell.css) or is built from the same
scale, and only semantic tokens are used, so all nine palettes in light and dark work with no
palette-specific code.

**Rail: identical to the board rail.**

| Element | Value (source) |
|---|---|
| Rail | 212px wide, `padding: 12px 8px 10px`, `gap: 14px`, `background: var(--rail, var(--inset))` (`.board-rail`) |
| "← Back" row | 30px tall, `padding: 0 8px`, radius 7px, `ChevronLeft` 15px / stroke 1.8, 13.5px `--fg-3`; hover `--inset-hover` with `--fg-1` (`.board-rail-toggle` colours, nav-item size) |
| "Settings" heading | 30px row, `padding: 0 8px`, 15px / 600 / `-0.03em`, `--fg-1` (`.board-rail-brand` type) |
| Nav items | 30px, `gap: 10px`, `padding: 0 8px`, radius 7px, 13.5px `--fg-2`, 1px between items; icon 15px / stroke 1.8 (`.board-rail-nav button`) |
| Current item | `background: var(--surface)`, `--fg-1`, weight 500, `box-shadow: 0 1px 2px rgba(0,0,0,.04)` (`[aria-current]`) |
| User card | `.board-rail-profile` layout: 28px avatar, 9px gap, name 13px / 500 `--fg-1`, email 12px `--fg-3` below; not interactive here, so no hover |
| Sign out | a nav-style item (30px, `LogOut` icon) under the user card |
| Focus | 2px `--fg-1` outline, 2px offset (the rail's focus rule); never the accent |

**Board rail Settings item:** a 30px nav-style item (`Settings` gear, 15px / stroke 1.8,
13.5px `--fg-2`) between New note and the account row, 6px above the account row. Collapsed
rail (52px): icon only, centred, label as tooltip, like the other items.

**Content: quiet rows on the wall, not a stack of cards.**

```
 canvas ───────────────────────────────────────────────────────────
   40px
   Appearance                                   20px / 600 / -0.02em, --fg-1
   Colours, light or dark, and the canvas…      13.5px / 1.5, --fg-3, 6px below
   28px
   ───────────────────────────────────────────  1px --border-subtle
   Colour palette                [Paper Wall ▾]   row ≥ 56px, 14px block padding
   ───────────────────────────────────────────
   Mode                  [System|Light|Dark]
   Follows your device when set to System.        hint 12px --fg-3, 2px below label
   ───────────────────────────────────────────
   Free canvas background  [Dots|Grid|Plain]
   ───────────────────────────────────────────
```

- Content sits on `--canvas`, like the board workspace, starting 48px from the rail, 40px from
  the top, with a 640px maximum width, left-aligned. No centred column.
- **A setting row:** label (13.5px / 500 / `--fg-1`) with an optional hint under it (12px /
  1.45 / `--fg-3`) on the left, the control on the right, vertically centred, at least 56px
  tall, hairline `--border-subtle` above and below. Selects are 220px wide; segmented
  controls keep their natural width. Below 520px of content width, the control moves under
  the label at full width.
- **A group heading** (only where a section has more than one group, such as "Your data" and
  "Delete account"): 13.5px / 600 / `--fg-1`, 32px above, 8px below, sentence case. No
  all-caps labels, no eyebrows, no numbering.
- **Connected apps:** each connection is a row (name 13.5px / 500, status dot and text 12px
  under it, Disconnect or Reconnect on the right). The setup steps are a numbered list,
  because they really are a sequence. The URL and client-ID fields are read-only inputs with
  a copy button.
- **Account and data:** Download is an outline button in its row. Delete account is a
  `destructive` button in its own row at the bottom. No red tint, border or panel (brand rule:
  status colour is never a fill, and the one filled red is the destructive action itself).
  Privacy and Terms sit as quiet 12px `--fg-3` links at the foot of the section.
- **Phone list:** rows 52px tall (44px minimum target), with the label, the one line in 12px
  `--fg-3`, and a `ChevronRight` 16px `--fg-faint` on the right; 16px side padding.
- **Touch** (`pointer: coarse`): every rail item and row target grows to 44px, matching the
  board.
- **Motion:** only the existing hover colour transitions. No entrance animations, no sliding
  panels. Reduced motion changes nothing because nothing moves.
- **Status messages** (saving, saved, failed) sit right under the control they belong to, in
  12px text, with `role="status"` or `role="alert"`. They never move the layout: the line's
  height is reserved.

### Copy

- Keep labels short and the existing terms (Connected apps, Account and data, Wallybot).
- Shorten the Connected apps introduction to one line (the table above). Keep the
  permissions explanation as a short hint near the connection list, at most one sentence.
- Tighten the setup steps where they repeat themselves; keep the client-ID step.
- The back link text "Back to boards" is replaced by "Back" (it no longer always goes to
  boards).

### Tests

- Unit tests for the settings shell (nav, `aria-current`, back target with and without origin,
  narrow list), the slimmed popover, and the rail's Settings item; update
  `AccountMenu.test.tsx`, `AccountPage.test.tsx` and `ConnectionsPage.test.tsx`.
- E2E (Playwright, `apps/web/e2e/`): a new `settings.spec.ts` that opens Settings from a board
  via the rail, switches sections, changes a setting, presses Back and lands on the same
  board; and on a phone viewport walks list → section → list. Update `connections.spec.ts`,
  `account-export.spec.ts` and `account-delete.spec.ts` only where copy or headings change;
  their addresses stay.

### Design quality checks

These run during the build, before the owner's local review, and their screenshots go to the
owner with the result.

1. **Rail parity, measured.** In the in-app browser (signed in by the owner, viewport at most
   1200px wide), open a board and Settings side by side and read the computed styles with a
   script: rail width, padding and background; nav item height, padding, radius, font size,
   weight and colour; the current item's background and shadow; focus outline. Every value
   must equal the board rail's. Any difference is a bug, not a judgement call.
2. **Screenshot matrix.** Settings at 1200×800, 1080×800 (the breakpoint), 1079×800 and
   390×844; in light and dark; in Paper Wall (default) and Minimal. Compare each against the
   board at the same size and against the layout sketches above: alignment to the 4px grid,
   row heights, the gap between rail and content, and no horizontal scroll at 320px.
3. **Design critique** with the `design:design-critique` skill on the screenshots: hierarchy,
   consistency with the board, anything that reads as a template. Fix what it finds, then
   take the screenshots again.
4. **Accessibility review** with the `design:accessibility-review` skill: keyboard order (Back,
   nav, content, user card, Sign out), `aria-current`, visible focus everywhere, contrast of
   hints and status text in all palettes (the existing contrast tests cover the tokens),
   44px touch targets, and screen-reader names for icon-only items in the collapsed rail.
5. **Copy review** with the `design:ux-copy` skill on every new and changed string, English
   and German: one job per line, sentence case, action labels that say what happens.

## Left to the builder

- Component structure (one `SettingsShell` with nested routes, or a shell per page), and
  whether section pages reuse `AccountSettings` / `ConnectionsSettings` as they are.
- Icon choice from lucide for each section.
- Whether the shared rail styles become shared classes or a small shared component.
