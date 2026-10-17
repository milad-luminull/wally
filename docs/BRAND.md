# Brand

Wally's visual identity: **Graphite + Marigold**. This document is the authority on intent;
the tokens live in `apps/web/src/styles/globals.css` and `apps/web/tailwind.config.ts`.

The short version: **the interface is graphite, the notes are the colour.** Cool,
near-neutral greys step from the wall up to ink. One warm marigold does exactly three jobs.
Everything colourful on the wall comes from the notes, and the notes belong to the user.

## Themes

Light and dark are both first-class. The default follows the operating system; the user can
pin either from the account menu or the command palette. The choice is saved to the profile
(`preferences.theme`) so it follows them across devices, and mirrored to localStorage
(`wally.theme`) so `index.html` can apply it before first paint — dark mode never flashes
white.

Every token has a value in `:root` and in `.dark`. Nothing outside `globals.css` branches on
the theme; components use semantic tokens only.

## Colour

| Token                 | Light     | Dark      | Job                                |
| --------------------- | --------- | --------- | ---------------------------------- |
| `--canvas`            | `#F6F6F7` | `#0A0A0B` | The wall                           |
| `--surface`           | `#FFFFFF` | `#121214` | Panels, popovers, the top bar      |
| `--inset`             | `#F0F0F2` | `#1B1B1F` | Wells: segmented tracks, skeletons |
| `--border`            | `#E4E4E8` | `#26262C` | Hairlines                          |
| `--fg-1`              | `#0E0E10` | `#EDEDEF` | Text, ink, the mark's front note   |
| `--fg-3`              | `#6A6A74` | `#8B8B95` | Secondary text, labels             |
| `--primary`           | `#18181B` | `#EDEDEF` | The everyday filled button         |
| `--accent` (marigold) | `#FFB224` | `#FFB224` | See below                          |

### Marigold has four jobs and no others

1. The single primary action on a screen — `<Button variant="accent">`. At most one at rest:
   "New note" on the board, "Invite" in the share popover.
2. The back note of the mark.
3. The auth backdrop's glow, as a soft tint only. Never a drag or drop state: a zone under a
   dragged note darkens a neutral shade, and the free canvas doesn't change at all.
4. The dot and its countdown ring on a note whose Wallybot changes are still pending, never
   a fill or an edge colour, and gone the moment the changes are kept or undone
   (`rfcs/WALLYBOT_INLINE.md`).

Text on marigold is near-black (`#1A1300`, 10.2:1) — never white. Focus rings and note
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

Fourteen fills. The persisted keys (`WEISS`, `SAND`, `BUTTER`, …) never change — only their
values do, so nothing migrates in Firestore. In light mode they are clean pastels; in dark mode
each is the same hue at ~16% over the surface. Cards carry a `--note-border` hairline so pale
fills never dissolve into the wall. On the wall a note is filled edge to edge; in the list it
is a small swatch beside the title.

Contrast floors, measured on every fill in both themes: body text ≥ 10:1,
`--fg-meta-on-note` ≥ 4.9:1, each status colour ≥ 5:1.

**Wally never colours a note on its own, never changes a colour, and never reads a colour as
status.**

## Type

**Geist** for everything, **Geist Mono** for keyboard hints and the 404. Both self-hosted from
`public/fonts` (SIL OFL), so the app makes no third-party request.

Six steps, nothing between them, nothing below 12:

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

- Radius: 6 for controls, 8 for notes and cards, 12 for panels and popovers.
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

Two notes on a wall: a marigold note behind and to the upper right, an ink note overlapping it
from the lower left, separated by a gap the colour of whatever is behind the mark. The ink note
is `--fg-1`, so it flips with the theme; marigold stays.

The wordmark is Geist SemiBold, **lowercase**, tracked −0.04em. Never capitalise in the logo; in
running text write Wally. Minimum 16px on screen — below that, the wordmark alone.

`BrandMark.tsx` draws it in one 24-unit viewBox; `public/favicon.svg` repeats the same numbers
in hex and must be kept in step.

**Don't**: tilt it · recolour it · add a third note · put a letter in it.

## AI

Wally has no AI today: no SDK, no route, no catalogue string, no icon. These rules are the
contract for when it arrives, and `brandGuards.test.ts` already enforces the first one.

> The AI is the wall's good manners. It fills in what you'd have typed anyway, puts things
> where you'd have put them, and gets out of the way.

1. No sparkle, wand, robot or brain icon anywhere in the product.
2. The AI has no name and no pronoun. Copy says "Wally set the date", never "I set the date".
3. AI output uses the same type, colour and layout as user input. The only markers are a
   dashed edge and the marigold dot with its countdown, and only until the changes are kept
   or undone.
4. Every AI action is reversible in one step, and the reversal is visible where the action
   happened.
5. The AI never interrupts. No toasts, no modals, no badges counting suggestions.
6. It never writes a note the user didn't start. It completes, files and reorders; it doesn't
   author.
7. Rewriting text is offered as a second version beside the original, never as a replacement.
8. Questions about the wall are answered in the panel in plain text, with the notes it read
   listed underneath.

### `Wand` is not a wand

`WandView`, `WandCanvas`, `board.topBar.view.wand`, `'Wally — Meine Wand'` — **Wand is German
for wall**, and it is this product's own domain word for the whiteboard. It is not the banned
AI metaphor. Do not grep for "wand" and "fix" it. The guard test matches lucide import
specifiers only, never filenames or identifiers.
