# Brand

Wally's current layout follows **Paper Wall**: a quiet workspace, a compact desktop navigation rail, a floating toolbar and softly elevated note cards. The public home introduces Wally and leads to the existing login and signup flows. Board behavior, saved positions and note colour identities stay unchanged.

The original **Graphite + Marigold** palette remains available as **Minimal**, with its original light and dark token values. The colour table below documents that baseline.

## Palettes and appearance

Palette and appearance are independent. Every palette has **Light**, **Dark** and OS-following **System** appearance. Available palettes are Minimal, Paper Wall (default), Clear Morning, Highlighter, Aurora, Daybreak, Sprout, Amber Poster and Neutral. These follow the local Luminull Brand Research and Wally Paper Wall v3 references; authored companion modes preserve each palette's hue identity with readable text.

Select a palette beside appearance in account settings, or through the appearance/language menu before signing in. Signed-in choices save to `preferences.palette` and `preferences.theme`; signed-out choices stay on the device. The profile takes precedence when it loads. `wally.palette` and `wally.theme` mirror the selection so `index.html` applies it before first paint. Missing/unknown local palette IDs fall back to Paper Wall.

`apps/web/src/styles/globals.css` retains the original Minimal tokens. `styles/palettes.css` overrides those same semantic tokens for the eight reference palettes, with light/dark blocks per palette; `lib/palettes.ts` defines selector swatches. Components use semantic tokens, never a palette-specific branch. A palette change does not rewrite notes or their colour identifiers. Contrast tests cover body/secondary text, action labels, metadata and status text across all 18 variants.

## Layout

At 1080px and wider, a 216px rail provides board switching, List, Horizon, Priority, Whiteboard, New note and account settings. Display still contains list grouping/reset. Search, filters, sharing, members, commands, rename and detail controls retain their existing behavior. Below that breakpoint, the existing list-only layout and top bar remain. Public pages and auth forms share responsive typography and appearance controls.

## Colour

| Token                 | Light     | Dark      | Job                                |
| --------------------- | --------- | --------- | ---------------------------------- |
| `--canvas`            | `#F6F6F7` | `#0A0A0B` | The wall                           |
| `--surface`           | `#FFFFFF` | `#121214` | Panels, popovers, the top bar      |
| `--inset`             | `#F0F0F2` | `#1B1B1F` | Wells: segmented tracks, skeletons |
| `--border`            | `#E4E4E8` | `#26262C` | Hairlines                          |
| `--fg-1`              | `#0E0E10` | `#EDEDEF` | Text, ink                          |
| `--fg-3`              | `#6A6A74` | `#8B8B95` | Secondary text, labels             |
| `--primary`           | `#18181B` | `#EDEDEF` | The everyday filled button         |
| `--accent` (marigold) | `#FFB224` | `#FFB224` | See below                          |

### The palette accent has these jobs

1. The single primary action on a screen — `<Button variant="accent">`. At most one at rest:
   "New note" on the board, "Invite" in the share popover.
2. Public-page calls to action. Never a drag or drop state: a zone under a
   dragged note darkens a neutral shade, and the free canvas doesn't change at all.
3. A note whose Wallybot changes are still pending (Paper Wall v3): the moving gradient border
   in the accent family around the card, the shimmer on the words while they are being read,
   the pulsing dots after "Filling in", and the small dot before each line of the proposed
   fields. Never a fill, and gone the moment the changes are kept or undone
   (`rfcs/WALLYBOT_INLINE.md`). The review footer's countdown ring is ink.

Text on Minimal’s marigold is near-black (`#1A1300`, 10.2:1) — never white. Other palettes use their tested `--accent-foreground`. Focus rings and note
selection are **ink**, never marigold, because they have to read on every note fill. Marigold
is not a note colour.

### Status colour is text, in the due-date line and nowhere else

No badges, no tinted rows. Overdue, today and done are text colours; everything else is
secondary grey. `brandGuards.test.ts` fails the build if a status token is used as a fill or a
border. The one filled red in the product is `--destructive`, for confirming a destructive
action — an action is not a status.

### Priority is shape, not hue

A signal meter: three rising bars in the current text colour, the level read off how many are
filled — three for high, two for medium, one for low — with the rest left as a faint track so
every level shows the whole scale. Red for priority is banned: red means late, and only late.
One colour is also what lets the icon survive on all fourteen note fills. See
`PriorityIcon.tsx`.

### Note colour belongs to the user

Fourteen fills. The persisted keys are the English labels (`CHALK`, `ICE`, `STONE`, …) and
never change again; the German keys they replace are migrated in place
([ADR-0014](adr/0014-english-identifiers-and-persisted-values.md)). In light mode they are clean pastels; in dark mode
each is the same hue at ~16% over the surface. Cards carry a `--note-border` hairline so pale
fills never dissolve into the wall. On the wall a note is filled edge to edge; in the list it
is a small swatch beside the title.

Minimal retains its original contrast floors: body text ≥ 10:1, metadata ≥ 4.9:1 and status text ≥ 5:1. Across all palettes, metadata, status and action labels meet at least 4.5:1; canvas body text meets 7:1.

**Wally never colours a note on its own, never changes a colour, and never reads a colour as
status.**

## Type

**Geist** for everything, **Geist Mono** for keyboard hints and the 404. Both self-hosted from
`public/fonts` (SIL OFL), so the app makes no third-party request.

The existing app type scale remains below. The public landing page adds responsive display typography; the rail uses compact brand and supplementary labels:

| Role             | Size | Weight  |
| ---------------- | ---- | ------- |
| Meta, labels     | 12   | 500     |
| Controls, rows   | 13   | 500     |
| Body, note title | 14   | 400/500 |
| Panel title      | 16   | 600     |
| Page title       | 20   | 600     |
| Display          | 28   | 500     |

Numbers are always tabular. Adding or removing a step means editing `theme.extend.fontSize`
**and** `FONT_SIZES` in `src/lib/cn.ts` together — tailwind-merge otherwise reads the size
class as a text colour and silently drops it.

## The wall

The zone views sit on a faint 20px dot grid. The free canvas — where notes are placed by hand —
takes the user's choice from the account menu or ⌘K, saved to `preferences.canvas`: **dots**
(the default, one dot every 28px), a **grid** of hairlines every 32px, or **plain**. Both
patterns stay under ~16% (dots) and ~5% (lines) opacity, so they give a sense of plane without
reading as a pattern; `--canvas-mark` and `--canvas-line` carry the per-theme values.

## Shape, depth and motion

- Radius: existing controls keep their scale; wall notes use 12px corners, desktop detail panels 18px outer corners, and the public illustration/auth surfaces 20–24px. Saved card geometry remains unchanged.
- Elevation `e1`–`e3`: soft shadows in light mode; in dark mode a hairline plus a deep shadow.
- Controls are 28 / 32 / 36px and grow to at least 40px on a coarse pointer.
- Motion is 120–180ms on transform and opacity only; reduced motion turns it off.

## Components

One look per job:

- `Button` — `default` (ink), `accent` (marigold, once), `outline`, `ghost`, `link`,
  `destructive`, `destructive-ghost`. Dialog actions reuse `buttonVariants`.
- Fields — `Input`, `Textarea` and `SelectTrigger` share `fieldClassName`; inline list inputs
  use `ghostFieldClassName`.
- `RemoveButton` is the only "×". `EmptyState` is the only empty state. `AppSkeleton` is the
  only full-page loading state.
- Destructive actions are immediate with an **Undo** toast, not a confirmation dialog.
- Every failed save says so in a toast; nothing snaps back silently.

## Keyboard

Every action is reachable with the mouse; the keyboard is an accelerator. ⌘K opens the command
palette. `N` new note, `/` search, `V` wall/list, `G` then `H`/`P`/`F` grouping, `Esc` or ⌘↵
closes the note, `?` shows the list. Single keys never fire while typing.

## Voice

Sentence case everywhere, zone and group labels included. Copy is short, second
person, no exclamation marks. "Nothing due today." not "You're all caught up! 🎉".

German is informal _du_ throughout, and German is the key authority: `de.ts` derives the `t()`
key union. Keys name a string's role, never its content, so re-wording never means renaming.

## The mark

A marigold face: a rounded square in a warm radial gradient (`#FFD36B` → `#F5A524` →
`#EE7A2F`, lit from the upper left), a soft white highlight at the upper left, and two ink eyes.
Its colours are fixed, so it reads the same on every palette and in both themes.

The wordmark is Geist SemiBold, **lowercase**, tracked −0.04em. Never capitalise in the logo; in
running text write Wally. Minimum 16px on screen — below that, the wordmark alone.

`BrandMark.tsx` draws it in one 100-unit viewBox; `public/favicon.svg` repeats the same numbers
and must be kept in step. The PNG favicons (16, 32, 48) and the 180px `apple-touch-icon.png` in
`public/` come from the design source in `wally-design/wally-logos`.

**Don't**: tilt it · recolour it to match a palette · add a mouth or other features · put a letter in it.

## AI

Wally's AI is three things on the board: the answer to a question typed into the capture card
(`features/board/Ask`), drawn as a card where the question was written, with the notes it read
listed underneath, and the fill-in on a note written in place (`features/board/Suggestions`), which
proposes a cleaner title and its description, a due date, a horizon, a priority, a person,
Private, properties, tags, subtasks and links to related notes as a pending change, reviewed on
the card itself and, with the same rows, in the note panel (rule 7 says how the title is
offered), and Tidy on the horizon wall
(`features/board/Tidy`), which proposes where jotted notes belong and moves them only on the
person's yes, every moved card carrying the Undo for a while. These rules are the contract all three
follow, and `brandGuards.test.ts` enforces the first one.

> The AI is the wall's good manners. It fills in what you'd have typed anyway, puts things
> where you'd have put them, and gets out of the way.

1. No sparkle, wand, robot or brain icon anywhere in the product.
2. The AI has no name and no pronoun. Copy says "Wally set the date", never "I set the date".
3. AI output uses the same type and colour as user input. While a fresh note's proposal is
   being made and waits for a decision, the card wears the moving gradient border (accent job
   4), lists the proposed fields under a hairline, one labelled line each with its ×, and ends
   in a footer with the countdown ring, the seconds left, Undo and Keep. Once kept or undone
   the card is an ordinary card again.
4. Every AI action is reversible in one step, and the reversal is visible where the action
   happened.
5. The AI never interrupts: no toasts, no modals, no badges counting suggestions. When it has
   nothing to add or cannot help (busy, a limit, a decision that did not save), it says so in
   one short line on its own card, answer or bar, and the person can dismiss it (the error
   handling spec, 2026-10-19).
6. It never writes a note the user didn't start. It completes, files and reorders; it doesn't
   author.
7. A cleaner title never replaces the person's words on the card while the proposal waits: the
   card keeps their title, and the new title is offered in a Title row (its text in a Text row
   under it) like any other field. It is written only by Keep or the countdown, and Undo
   restores the original.
8. Questions about the wall are answered on the wall, as a card where the question was written,
   in plain text, with the notes it read listed underneath. The card has the dashed edge and
   nothing else: no dot, no ring, because nothing is written.

### "Wand" is the German word for the wall

It appears only in the German catalogue (`Wand`, `'Wally — Meine Wand'`) and in the German
default board name. Code names are English (`WallView`, `WallCanvas`, `board.topBar.view.wall`;
[ADR-0014](adr/0014-english-identifiers-and-persisted-values.md) renames what still carries
it). The guard test matches lucide import specifiers only, never catalogue values.

### Connection status lights

Connected apps has an explicit exception to the text-only status colour rule: small
green, gray and red dots show connected, not connected and disconnected/error states.
Each dot accompanies a visible text label. This exception does not permit tinted rows,
cards or banners. Approved by the owner on 2026-10-22.
