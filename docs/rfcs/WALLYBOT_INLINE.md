# Wallybot inline — review and plan

**Status:** accepted 2026-10-16. All five decisions in §6 were approved as recommended; slice 1 (§5) started the same day; slice 2 (§3.3, §4) started 2026-10-17; slice 3 started the same day (subtasks, a reference, the title line, and the note panel's review in two groups, "From what you typed" and "Added by Wallybot"); links between notes moved to a follow-up slice (slice 3 plan, R1); slice 4 shipped 2026-10-18 (questions answered as a card where they were written, the question panel retired); slice 5 (Tidy) started 2026-10-18, as an explicit action that waits for Enter (plan R1).
Links follow-up (slice 3's R1) implemented 2026-10-18: stored relations, proposals kept one by one, a panel picker, and hairlines on the free canvas.
**Last revised:** 2026-10-18.
**Sources:** the first customer feedback (write the title and text on the board itself, the
sidebar only for details); the Claude Design page "Wallybot Inline" and its notes document
(the brief with the mindset, shared model, variants 3a/3b/3c, AI call, settings and don'ts);
the shipped question panel (PR #42) and the owner's verdict on it.

Read next to [`WALLY_AGENT.md`](WALLY_AGENT.md), whose requirements this proposal amends in
§3.2 and §3.3, and [`../BRAND.md`](../BRAND.md) "## AI", whose rules it amends in two places.

---

## 1. What is wrong with what we built

The question panel does what its requirements said and nothing a person would call modern:

- It is a conversation beside the board. A field, a stack of answers, "earlier". The brief's
  framing is right: nobody should open Wallybot. The value of "ask the board" is small next to
  the value of a note that files itself.
- It has no motion. The brand allows 120–180 ms on transform and opacity; the panel uses none
  of it. Nothing on the wall shows that something happened.
- Its edges are rough: an empty conversation showed a blank panel, the field kept the question
  twice, the top bar overlapped on phones. These were found live and fixed, but they are the
  marks of a surface built from a spec rather than from use.

What is worth keeping from that work is everything under it: the operations over the command
layer, the audit record, the budget ledger, the model boundary, the conversation storage, the
chips. The brief's three variants all sit on exactly that foundation. The panel itself is
retired as the main surface (§3.6).

## 2. Review of the brief and the design

**Keep as written.** These are the right rules and the implementation plan follows them:

- The user writes, Wallybot follows. The note exists on the first keystroke; enrichment is a
  layer on top; nothing waits on a model.
- Propose, then apply. Every change is a pending diff on the note until it is kept. This is the
  approval record `WALLY_AGENT.md` already requires, with a better name.
- Always reversible, during review and for a while after.
- Show where it came from: each field carries `typed`, `inferred` or `linked` and a short reason.
- The AI look is temporary. A kept note looks like any other note.
- One controller and state machine (`idle → typing → thinking → review → applied | undone`)
  shared by the variants; only the UI differs.
- A fast local parse with no AI for dates, people and urgency, keeping up with every keystroke.
- Strict JSON out of the model, validated, low-confidence fields dropped; silent failure, the
  note stays as written; a newer edit cancels the request in flight.

**Conflicts to resolve.** Four points contradict accepted rules; each gets a recommendation
in §6:

1. _Silence means yes._ The RFC says every write pauses for a yes. The brief auto-applies
   after a countdown. These can be reconciled for one case only: enrichment of a note the
   person just wrote, where undo is one keystroke and nothing else on the board moved. The
   server still records an explicit decision; the countdown's expiry is one way of giving it.
2. _Colour._ The brief lets Wallybot propose a colour. BRAND.md: "Wally never colours a note on
   its own, never changes a colour, and never reads a colour as status." One of the two must
   change.
3. _The amber edge and dot._ BRAND.md gives marigold three jobs and no others, and makes the AI's
   only marker a dashed line. The design uses an amber edge with a dot and a countdown ring.
   It reads well and it is temporary, which is the brand's own condition.
4. _Toasts and automatic movement (3c)._ BRAND.md: the AI never interrupts, no toasts. The brief's
   3c moves notes into Today / This week / Later on its own after a pause and announces it with
   a batch toast. Moving notes the person placed is the one action a user of a wall will resent.

**The prototype's code is not reused.** The notes document says so itself: its keyword parser
and timers are stand-ins. The design is the contract for look and behaviour, not for code.

## 3. The experience

Everything happens on the note, on the wall or in the list. No panel opens unless the person
asks for details.

### 3.1 Write in place (no AI)

- `N`, the New note button, or a click on an empty spot of the free canvas puts a blank card
  where the note will live, with the title line focused. In the list it is a new row at the
  top. On a phone it is the same row at the top of the list.
- Typing is the note. The note is created on the first keystroke (optimistic, as today) so a
  reload or a crash never loses a line. Enter commits. Shift+Enter starts the description line
  on the same card. Esc on an empty card removes it. Click elsewhere commits.
- The sidebar opens only on a deliberate action: a click on a committed card, `⌘↵`, or "More"
  on the card. It is the detail layer, as the feedback asks.
- Motion: the card grows from the click point in 150 ms; a committed card settles with a 120 ms
  opacity change; nothing bounces.

This slice has no AI in it and is where the customer feedback is answered. It ships first.

### 3.2 Understand while typing (3b, the local half)

- While the person types, a local parser (no network) finds dates ("Freitag", "next week",
  "16.10."), people (`@anna`, and member names), and urgency words ("dringend", "asap", "hoch").
  Matches are underlined in the text and appear as small chips under the line as the person
  types, in the same type and colour as the note. The chips are proposals: a tap on a chip
  keeps it, `×` drops it; nothing is applied until Enter.
- This runs on every keystroke and must never stutter: a pure function over the shared package,
  with the member list and the locale as inputs.

### 3.3 Fill in on Enter (3a, the default)

- On commit, the card gets a dashed edge with a marigold dot in its corner. Fields stream onto
  the card as they arrive: due date, priority, assignee, reference, subtasks, each in the place
  it has on a normal card, each with a `×`. The title keeps the person's wording; if Wallybot
  proposes a cleaner one, it appears as a second line with "use mine" beside it, never as a
  replacement.
- The dot fills as a countdown ring (default 6 s). Hover or focus pauses it. Esc undoes
  everything, Enter keeps everything, a `×` removes one field without touching the rest.
  Editing a field during review wins: that field leaves the proposal.
- When kept, the dashed edge and the dot fade over 180 ms and the card folds back to its compact
  form. For the next 30 s a faint "Undo" sits where the dot was; `⌘Z` works too. No toast.
- When the model fails or times out, the card simply stops showing the dot. Nothing is said.

### 3.4 Review grouped by source (3b, the AI half)

- After commit, the AI adds what the parser could not: subtasks, a reference ("Kunde: Müller
  GmbH"), links to related notes on the wall. On the card these fields show with a small source
  mark; expanding the card during review shows two groups, **From what you typed** and
  **Added by Wallybot**, each row with a checkbox, the card updating as rows are ticked.
- A link to a related note is drawn on the free canvas as a hairline (the zone bands and the list show the relation in the note panel) while the proposal is pending,
  and stays only if kept.

### 3.5 Tidy after a pause (3c) becomes an explicit action

- Nothing moves on its own. After a session of jotting, the wall shows one quiet affordance
  at the edge of the zone bands: "Tidy 4 notes". Choosing it runs the batch: notes move into
  Today / This week / Later with a 180 ms transform each, staggered, and every moved note
  carries the dot and the countdown; one Undo reverts the batch including positions.
  Decision 1 applies: a move is never applied by a countdown, so the dot waits for the person's
  Enter and the moves are shown on the cards first (slice 5 plan, R1).
- The countdown and undo are per batch; the summary lives on the cards, not in a toast.

### 3.6 Questions

The question panel is retired as a surface. A question typed into the capture card, ending in
`?`, is answered as an ephemeral card on the wall: same type, dashed edge, the notes it relied
on underneath as rows, and it fades after it is read unless pinned. The route, the ledger and
the conversation storage from PR #41 serve it unchanged. Shipped as slice 4 (2026-10-18); the
panel is retired.

### 3.7 Settings

In the account menu under "Wallybot": auto-apply delay (default 6 s), hover pauses, "always
ask me" (no auto-apply), and per-field opt-outs. The board owner's switch from PR #40 remains.

## 4. Architecture, on what exists

- **Suggestion is the approval record.** `Suggestion { noteId, baseVersion, fields, status,
expiresAt }` is stored by the server, bound to the note's `expectedRevision` (`baseVersion`),
  with a fresh operation id, exactly as `WALLY_AGENT.md` §3.2 requires. A decision reaches the
  server as `{ approvalId, decision: 'keep' | 'undo' | 'partial', fields?, source: 'enter' |
'countdown' | 'esc' | 'checkbox' }`; the server applies kept fields through `runOperation`
  (`update_note`, `add_subtask`, `assign_note`) under the stored operation id, and refuses with
  `409 STALE_REVISION` if the note changed underneath, which is the brief's "discard if the
  note changed".
- **One model call, strict JSON.** A capture turn is one call with the raw text, today's date,
  the locale, the nearby or related notes (compact rows), and the wall's existing tags and
  fields, returning `Suggestion.fields`. It runs through the boundary with a schema-validated
  output and the same reservation, settlement and caps as a question. No tool loop, so it is
  cheaper than a question.
- **Streaming is a presentation first.** The API returns the whole suggestion; the UI reveals
  fields one at a time. Real streaming through the boundary is a later improvement; the
  interface does not change.
- **Local parse in `packages/shared`**, pure, with its own tests for German and English dates,
  member names and urgency words. The server never runs it; it is the client's instant layer.
- **Undo after keep** is the command layer's own revision history: "undo" sends the inverse
  update with the kept revision as `expectedRevision`.

## 5. Slices

1. **Write in place** (§3.1) plus the local parser and chips (§3.2). No AI, no new stored
   shape, one PR. The feedback is answered the day it merges.
2. **Suggestion record and the capture turn** (§3.3, §4): the stored record, the route, the
   one-call turn with strict JSON, the dashed card with streaming fields, countdown, keep,
   undo, per-field remove. BRAND.md and WALLY_AGENT.md amended per §6.
3. **Grouped review and links** (§3.4).
4. **Questions on the wall** (§3.6), retiring the panel.
5. **Tidy** (§3.5), if approved as an explicit action.

Each slice follows the process of the previous ones: a plan with full code per task, Opus
implementing and reviewing in sequence, a whole-branch review, one fix wave, a visual pass in
the browser pane against the live board.

## 6. Decisions (all approved as recommended, 2026-10-16)

1. **Silence means yes, for enrichment of a fresh note only.** Recommended: yes, with
   "always ask me" as a setting and no auto-apply for anything that touches an existing note
   or moves one. Amends WALLY_AGENT.md §3.2 "Writes wait for a yes".
2. **Colour.** Recommended: Wallybot never proposes a colour. Drop it from the suggestion
   fields; BRAND.md stays as it is.
3. **Marigold as the pending marker.** Recommended: yes, a fourth job for marigold, limited to
   the dot and the countdown ring on a pending card, never a fill. Amends BRAND.md "Marigold has
   three jobs" and AI rule 3.
4. **Automatic tidy (3c).** Recommended: no automatic movement; an explicit "Tidy" action with
   the same countdown and undo.
5. **Toasts.** Recommended: none. Undo lives on the card.

## 7. Don'ts, carried from the brief

Don't block typing or steal focus. Don't open a modal. Don't silently overwrite what the person
typed. Don't keep the AI styling on a note once its changes are kept. And one of our own: don't
move a note the person placed without being asked.
