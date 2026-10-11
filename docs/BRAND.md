# Brand

Wally's visual identity, transcribed from `wally - branding.pdf` v1 and reconciled with what
the code can actually do. The guideline is the authority on intent; where a rule collided with
a contrast floor this document records the deviation and why.

The short version: **the interface is a warm grey room.** Slate, linen, chalk, taupe, sand,
one typeface, and one blue that does exactly three jobs. Everything colourful on the wall
comes from the notes, and the notes belong to the user.

## Colour

| Token     | Hex       | Job                                   |
| --------- | --------- | ------------------------------------- |
| `--slate` | `#22303F` | Text, the mark, the primary button    |
| `--blue`  | `#4F7196` | The pin, one CTA, the selection state |
| `--linen` | `#EDE8DF` | The wall                              |
| `--chalk` | `#FFFFFF` | Notes, panels                         |
| `--taupe` | `#5F5A50` | Secondary text                        |
| `--sand`  | `#D8D0C3` | Hairlines, dividers                   |

### Blue has three jobs and no others

1. The pin in the mark.
2. The one primary action on a screen — `<Button variant="accent">`. At most one at rest.
3. The selection state: the focus ring, a selected chip, a selected segment.

Blue is a fill, never a text colour. Text on blue is white (5.08:1). **Never blue for AI** —
the AI has no colour. A blue note is forbidden twice over: blue is functional, and a blue note
would read as selected.

Note selection is the one exception to job 3: a selected note gets a **2px slate outline**,
with the note's own colour left showing underneath, because blue would fight the fill.

### Status colour is text, in the due-date line and nowhere else

No badges. No tinted rows. Overdue, today, done, and everything else in taupe.

**Deviation — the three status hues are darkened.** The guideline gives Overdue `#B3261E`,
Today `#8A5A00` and Done `#1E7A4E`, and separately says a coloured note is filled edge to
edge. Those two rules collide: the due line sits on the note fill, where the published hues
measure 3.56:1, 3.23:1 and 2.90:1 on Clay — they only clear AA on a white chalk note. The
tokens are the same three hues darkened in linear-light space, hue and chroma preserved, until
the worst case across all fourteen fills clears 4.5:1:

|         | Guideline | Shipped   | Worst case on a note |
| ------- | --------- | --------- | -------------------- |
| Overdue | `#B3261E` | `#921D17` | 4.50:1               |
| Today   | `#8A5A00` | `#684300` | 4.54:1               |
| Done    | `#1E7A4E` | `#125636` | 4.50:1               |

A destructive _action_ — the confirm button of a delete dialog — is not a status, so it sits
outside this rule and is the one filled red in the product. It uses the same red.

### Priority is shape, not hue

One slate dot. High is filled, medium is the same dot hollow, **low has no mark at all**.
Red for priority is banned: red means late, and only late. Keeping priority on a single colour
is also what lets it survive on any of the fourteen note fills. See `PriorityDot.tsx`; every
caller has to cope with it rendering nothing.

### Note colour belongs to the user

Fourteen fills. Seven are the guideline's palette exactly; seven are derived into the same
linen-dyed band so that every persisted value survives — nothing migrated in Firestore — and
every name finally matches its hue. Before this change four of them aliased status tokens, so
`SAND` was orange and `MINZE` was dark green.

|                   | Guideline |            | Derived   |
| ----------------- | --------- | ---------- | --------- |
| `WEISS` Chalk     | `#FFFFFF` | `EIS`      | `#D5DEE3` |
| `SAND` Stone      | `#D8D0C3` | `HIMMEL`   | `#BDCEDE` |
| `BUTTER` Oat      | `#E3D5B8` | `MINZE`    | `#C9DBD3` |
| `LEHM` Clay       | `#D9B9A6` | `SEEGRUEN` | `#B6C9C2` |
| `NEBEL` Mist      | `#C5D3DF` | `OLIV`     | `#CBCCAF` |
| `SALBEI` Sage     | `#C9D2C4` | `ROSE`     | `#E1C4C8` |
| `FLIEDER` Heather | `#CFC6D6` | `MALVE`    | `#C4B6C6` |

A note is coloured **all over, like paper — full fill, not a stripe**. One token per colour,
used for the card, the list row and the picker dot alike.

Contrast floor for anything added here: slate ≥ 5:1 and `--fg-meta-on-note` ≥ 4.5:1. Measured
worst cases today are 6.95:1 and 4.54:1, both on Malve.

**Deviation — `--fg-meta-on-note`.** Taupe clears 4.5:1 on most note fills but not all: it
measures 3.73:1 on Clay and 4.14:1 on Heather, two of the guideline's own seven. Meta text on
a coloured note uses one step darker, `#4F4A41`. Body text is slate everywhere and never
needed the help.

They carry no built-in meaning. **Wally never colours a note on its own, never changes a
colour, and never reads a colour as status.** If a team agrees "Clay = waiting on client",
that lives in the team's head or in a tag, not in Wally.

## Type

One typeface: **Sora**, self-hosted from `public/fonts` so the app makes no third-party
request. It ships as a variable font, so all four weights are two files.

Six steps, nothing between them, nothing below 12:

| Role       | Size | Weight | Tracking                |
| ---------- | ---- | ------ | ----------------------- |
| Display    | 40   | 700    | −0.045em                |
| Title      | 22   | 600    | −0.03em                 |
| Note title | 15   | 600    | −0.01em                 |
| Body       | 14   | 400    | 1.55 line-height        |
| Meta       | 12   | 500    | taupe, tabular numerals |

400 for reading, 500 for meta, 600 for titles, 700 only for display and the wordmark. Two
weights per screen is the norm, three the limit. Numbers are always tabular.

Adding or removing a step means editing `theme.extend.fontSize` **and** `FONT_SIZES` in
`src/lib/cn.ts` together — tailwind-merge otherwise reads the size class as a text colour and
silently drops it.

## Voice

Sentence case everywhere. Uppercase only for zone labels on the wall. Copy is short, second
person, no exclamation marks. "Nothing due today." not "You're all caught up! 🎉".

German is informal _du_ throughout, and German is the key authority: `de.ts` derives the `t()`
key union. Keys name a string's role, never its content, so re-wording never means renaming.

## The mark

A square note, corner radius **22%** of its side, with one round pin at top centre. The pin's
diameter is **21%** of the side and its centre sits **28%** down from the top edge. Nothing
else. The shape reads at 16px and at 16 metres.

Slate note with a blue pin is the primary mark; on slate the pair inverts. Keep half the
mark's width free on every side. Minimum 16px on screen — below that, the wordmark alone.

The wordmark is Sora Bold, **lowercase**, tracked −0.045em, with a gap between mark and word
equal to the pin diameter. Never capitalise in the logo; in running text write Wally.

**Don't**: tilt it · recolour it · add pins · shadow or gradient · put a letter in it ·
round it off.

`BrandMark.tsx` expresses every measurement as a ratio of the side, so one component covers
every size. `public/favicon.svg` repeats the same numbers in hex and must be kept in step.

The board-initial square in the top bar is the **board's** mark, not the brand's — it is a
circle precisely so it cannot be misread as the logo.

## AI

Wally has no AI today: no SDK, no route, no catalogue string, no icon. These rules are the
contract for when it arrives, and `brandGuards.test.ts` already enforces the first one.

> The AI is the wall's good manners. It fills in what you'd have typed anyway, puts things
> where you'd have put them, and gets out of the way.

1. No sparkle, wand, robot or brain icon anywhere in the product.
2. The AI has no name and no pronoun. Copy says "Wally set the date", never "I set the date".
3. AI output uses the same type, colour and layout as user input. The only marker is a dashed
   line, and only until accepted.
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
