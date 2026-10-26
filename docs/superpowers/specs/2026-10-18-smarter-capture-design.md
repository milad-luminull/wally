# Smarter capture: Wallybot fills in what a person means

Date: 2026-10-18. Status: draft for the owner's approval. Branch `feat/smarter-capture`.

## Why

The owner's verdict after using it: what they write is saved "the same or almost the same",
and nothing about it reads as intelligent. In practice:

- only a company name ever turns into a property;
- priority appears only when a word like "urgent" is written;
- a date appears only when it is exact; "this week" gives nothing;
- a private matter is never marked private;
- a task with obvious steps gets no steps unless the person listed them.

The causes are in the capture call, not in the model and not in the UI:

1. The instructions forbid inference. `CAPTURE_INSTRUCTIONS_PREFIX`
   (`apps/api/src/lib/assistant/capturePrompt.ts`) says "fill in what the note itself says and
   nothing more" and "give null unless the words state it clearly"; priority is a keyword list;
   steps only "when the words describe several things to do". The server then drops anything
   under `SUGGESTION_MIN_CONFIDENCE` (0.6).
2. Half the card is out of reach. A proposal can hold a date, high/low priority, a person, a
   title line, **one** property, steps and links. It cannot hold the horizon (Today / This week
   / Later), visibility, tags, more than one property, or a description. "This week" has no
   field to land in, because the only time field is an exact date.
3. The model sees little of the board: members, property keys (no values), other notes' titles.
   It never sees the board's tags or how properties are usually filled in.
4. The answer allowance (`SUGGESTION_MAX_OUTPUT_TOKENS`, 512) is sized for today's few fields.

## Goals

- A fresh note comes back filled in the way a sharp assistant would fill it: inferred from the
  words, the board and common sense, each field with its short reason.
- The proposal can reach the whole card that matters for a task: horizon, visibility, tags,
  several properties and a description join today's fields.
- The countdown before a silent keep is long enough to read: 15 s instead of 6 s.
- The proposal is plain to see and act on, on the wall and in the list: fields arrive one by
  one as a labelled list, with a visible countdown and Undo / Keep (Paper Wall v3).
- "Smarter" is measured on a fixed set of sample notes, before and after.
- Capture in the list view is verified working end to end once the work is done.

## Non-goals

- No model change. The deployment stays on `vertex:gemini-2.5-flash` in the EU with thinking
  off (`suggestionCallSettings`). Owner's decision: better instructions and context first. If
  the sample set shows the model is the limit, that is a later, separate decision.
- No new screens or settings. The only UI change is the pending card itself (section 5),
  following the owner's Paper Wall v3 mockup within the brand rules. The review panel
  (`PendingReview`) gains rows for the new fields and nothing else.
- No change to the local, keystroke-time parser (`apps/web/src/lib/capture/parseCapture.ts`).
  What it finds while typing stays locked for the model exactly as today.
- No proposals for existing notes; Tidy is unchanged. No colour proposals (RFC decision 2).

## Anti-goals (it fails even if it works if…)

- It invents facts: a name, number, customer, date or person the words and board do not support.
- It makes a note **shared** that the person wrote as private, or exposes anything to another
  member that the person did not choose to share.
- It moves or rewrites a note the person already placed or edited, or overwrites a field they set.
- Its reasons speak in the first person, name itself, or use AI iconography (BRAND.md "## AI").
- It noticeably slows capture: the call keeps its 20 s deadline and the card never waits on it.

## Constraints

- RFC `docs/rfcs/0005-wallybot-inline.md` §3.3–3.4 and §7 stand: no modal, no toast, never overwrite
  what was typed, the title stays the person's unless they take the offered one.
- Plan R2 stands: the title line is opt-in and never kept by the countdown. The new description
  rides with it (see below).
- Persisted enum values stay as they are until the values release (ADR-0014): `HEUTE`,
  `DIESE_WOCHE`, `SPAETER`, `PRIVATE`, `HOCH`, `NIEDRIG`.
- Code, identifiers and test data in English; German only in `de.ts` (authority), the parser
  word list and the German trigger words in the prompt (ADR-0014, owner rule).
- Every keep is a chain of existing operations with receipts and an exact undo
  (`suggestions.ts`: `stepsFor`, `stepCall`, `stillWritten`). New fields follow that pattern
  using operations that exist today: `move_note` (mode `HORIZON`), `update_note` with
  `visibility`, `tagChanges`, `fieldChanges`, `description`.
- Older stored proposals (7-day retention) must still read and decide correctly after deploy.
- Budget caps and the ledger stay authoritative; estimates must count the larger prompt and
  allowance.
- The UI builds on PR #60 (Paper Wall uplift, merged into `main` as `23189982`; this branch
  is rebased on it): its palettes, the `paper-note` card surface and its BRAND.md, whose
  "## AI" rules are unchanged by it.
- Styling uses PR #60's semantic tokens only (`--accent`, `--note-border`, `--fg-meta-on-note`,
  `--primary`, the palette's `--accent-foreground`), never the mockup's hard-coded amber, so the
  card reads right in all nine palettes, light and dark.

## Owner's decisions

1. **Model:** unchanged (see Non-goals).
2. **Countdown:** 15 s (`COUNTDOWN_MS` in `apps/web/src/features/board/Suggestions/useSuggestions.ts`,
   and every test and doc line that states 6 s). Hover/focus still pauses it; Esc and the
   footer's Undo discard; `×` crosses one field out; Undo still holds for 30 s after a keep.
3. **Horizon:** Wallybot may set This week or Later on the note just written, never on an
   existing note. On a horizon wall a kept horizon moves the fresh card to that column; Undo
   moves it back.
4. **Visibility:** Wallybot may propose Private, never Shared. Private is **opt-in, like the
   title line**: it shows as a chip the person ticks, and the countdown never keeps it (it
   joins `title` and `description` in the countdown exclusion in `decideSuggestion` and in
   `useSuggestions`). A wrong guess would hide the note from everyone else.
5. **Scoring:** the owner runs the scoring script twice, a baseline before the prompt changes
   and a final run at the end. The PR is called ready only after the final run, and only with
   zero failures on the anti-goal fixtures.
6. **Pending card from Paper Wall v3, within the brand rules of PR #60:** a labelled field list
   and a review footer (section 5). The mockup's spinning gradient border, shimmering text,
   "Wallybot is filling in" label, ✦ mark, toasts, colour and estimate fields are not taken.
7. **Review before any PR:** the work stays on the local branch. The owner reviews the changes
   (the diff and a preview) before anything is pushed or a PR is opened.

## The design

### 1. The instructions change from "copy" to "understand"

Rewrite `CAPTURE_INSTRUCTIONS_PREFIX` around one rule: _fill in what a capable assistant would
set for this task, inferring from the words, the board and common sense; never invent a fact
the words and board do not support._ Each field's line says what counts as a signal. The
confidence and reason contract stays (reason ≤ ten words, quoting or naming the signal, in the
answer language). Byte-stability for caching stays: board content goes in the prompt, never in
the instructions.

Per field (existing ones get smarter, new ones are added):

| Field                                            | Today                      | After                                                                                                                                                                                                              |
| ------------------------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `dueDate`                                        | exact dates only           | deadlines stated or clearly implied ("by Friday", "before the 3rd", "end of month", "EOD"). Vague spans ("this week", "next week", "soon") go to `horizon`, not to a made-up date.                                 |
| `horizon` _(new)_                                | —                          | `DIESE_WOCHE` or `SPAETER` from timing words or from a proposed date's distance (this week → This week; later → Later). Never `HEUTE`: that is the default and so proposes nothing.                                |
| `priority`                                       | urgent/defer keywords      | judged from stakes and timing: a near deadline with an outside party, a blocker, an escalation → `HOCH`; "when there's time", "nice to have", someday → `NIEDRIG`; ordinary tasks → none.                          |
| `assignee`                                       | a named member             | also "ask Anna to…", "Anna sends…", "@anna"; still only ids from the member list.                                                                                                                                  |
| `visibility` _(new)_                             | —                          | `PRIVATE` for clearly personal matters (health, family, personal money, salary, own job applications, a gift for a colleague) or explicit "private", "just for me". Nothing else.                                  |
| `title`                                          | shorter, identical meaning | a clean title when the typed one is long, rambling, or still carries words that became fields ("Call Anna tomorrow urgent" → "Call Anna"). Opt-in as today (R2).                                                   |
| `description` _(new)_                            | —                          | when the typed title carries detail beyond a title, the detail moves here and `title` is the short form. Proposed only while the note has no description. Opt-in with the title (R2): never kept by the countdown. |
| `properties` _(replaces the single `reference`)_ | one property               | up to three, e.g. Customer, Project, Contract number; reuse board keys and, where the value matches one already used, its spelling.                                                                                |
| `tags` _(new)_                                   | —                          | up to three; prefer the board's existing tags; a new tag only for a clear category.                                                                                                                                |
| `subtasks`                                       | only when listed           | also for tasks that naturally have steps ("prepare board meeting"), two to five concrete steps; none for single-action tasks ("call mom").                                                                         |
| `links`                                          | as merged in PR #57/#58    | unchanged.                                                                                                                                                                                                         |

Consistency rules the server enforces after the model answers (not left to the model):

- `visibility: PRIVATE` drops any `assignee` proposal (a private note is always its author's).
- A `horizon` that contradicts a kept-able `dueDate` is dropped (a date today or tomorrow with
  "Later", for instance).
- A proposed `dueDate` before today is dropped (as today).

### 2. The model sees more of the board

`buildCapturePrompt` adds, as data:

- the board's tags in use (one per line, deduplicated with the same fold the UI uses);
- each property key with up to three example values in use;
- a few of the person's own recent notes (my call: up to ten, newest first, only notes the
  caller can see) as title plus their horizon, priority, tags and properties, so the model can
  follow how this person files tasks.

**Private context never reaches a shared note** (my call, from the anti-goal): when the note
being filled in is shared, the tags, property values and example notes above are drawn from
shared notes only. A private note may draw on everything the caller can see. Tests and
fixtures cover a tag that exists only on a private note and must not be proposed on a shared
one.

The existing member list and the other notes (`CAPTURE_MAX_OTHER_NOTES`) stay. Board content
never enters the instructions. The prompt-injection line stays.

### 3. Candidates and locks

`candidates()` gains the new fields, each open only when the note still holds nothing there and
the person did not decide it while writing:

- `horizon`: note is at `HEUTE`, and not locked. The capture card locks `horizon` when the person
  wrote into a column they picked on the horizon wall, as it already locks `priority` on the
  priority wall. A note opened by the New note button in the default column is not locked.
- `visibility`: note is `SHARED`, the caller is its creator and may change visibility (the
  command's own rule in `commands/index.ts`), the board has at least one other member, the note
  has no assignee and `assignee` is not locked (a person the writer named is never replaced by
  the author), and the note was not written while the board's visibility filter was "Shared"
  (the capture card locks `visibility` then, as a deliberate choice).
- `tags`: note has no tags. `properties`: note has no properties (as `reference` today).
  `description`: note has no description.

`suggestionFieldKeys` and the request's `locked` list grow to match.

### 4. Keep and undo

Each new field is one step in the existing chain, with its exact restore:

- `horizon`: `move_note` `{ mode: 'HORIZON', horizon }`; undo moves back to `HEUTE`.
- `visibility`: `update_note` `{ visibility: 'PRIVATE' }` (the command also assigns the author);
  undo sets `SHARED` and the assignee back to what it held at the base revision.
- `tags`: `update_note` `{ tagChanges: { add } }`; undo removes those still present.
- `properties`: one `fieldChanges.set` with the kept keys; undo removes the keys whose values are
  still the written ones.
- `description`: `update_note` `{ description }`; undo restores `''` while it is still the
  written text.

Kept items within a multi-value field (tags, properties) are chosen per item in the review, the
same way subtasks and links are today.

### 5. On screen

Reference: `../wally-design/Wally Paper Wall v3.dc.html` (the inline create card in a lane) and
its brief `Inline Create Card - Brief for Codex.md`. What is taken, adapted to BRAND.md "## AI"
as PR #60 leaves it (no name, no pronoun, no sparkle icon, no toast, markers limited to the
dashed edge and the accent dot with its ring, motion 120–180 ms on opacity and transform,
reduced motion turns it off):

**While the call runs (`asking`).** The card keeps the person's words and the dashed edge; the
dot shows at half strength as today. The footer (below) reads "Filling in…" with no ring and
no buttons. No shimmer, no gradient border, no spinner.

**When the proposal arrives.** The fields appear one at a time as a **labelled list** under
the title, separated by a hairline (`--note-border`): a small accent dot, a short label
(Due, Priority, When, Person, Private, Tags, then each property's own key, Steps, Related), the
value, and `×`. Rows fade and rise in (opacity and a few pixels of translate, 150 ms each,
about 100 ms apart); subtasks follow the same way. Under reduced motion all rows appear at
once. Each row's reason is its tooltip and accessible description, as the chips' reasons are
today. The same list is used on the wall card and, condensed to the same rows, under the list
row, so both views look and behave the same.

- `×` crosses a row out (struck through, faded) and turns into `↺`, which brings it back; a
  crossed-out row is left out of the keep. This replaces today's "× removes the chip".
- Multi-value rows (Tags, Steps, Related) cross out per item.
- Private is a row that starts crossed out and is ticked in to take part (owner's decision 4).
- The offered title keeps today's form on the title line, with "use mine" (R2); the offered
  description sits under it in the same opt-in state and is taken together with it.

**The review footer.** Under the list, behind a hairline: the countdown ring (the accent ring
the dot draws today, moved here), "Saves in 12 s" or "Paused", then **Undo** (outline) and
**Keep** (the palette's `--primary` filled button, not the accent, which stays one per
screen). Hover or focus pauses; Enter keeps, Esc undoes, as today. While pending, the card's
done checkbox is hidden so a stray click cannot complete a note under review. The corner dot
remains as the at-a-glance marker.

**After a keep.** The dashed edge, list styling and footer go; the card is an ordinary
`paper-note` card with the kept values in their usual places, and the faint Undo sits where
the dot was for 30 s, as today. After an Undo the card is as written, silently.

**Not taken from the mockup:** the batch bar ("filled in N notes · Undo all · Keep all"; it
names the AI and counts suggestions, rule 5), the spinning gradient border and shimmer
(rule 3 and the motion limits), the ✦ "filled in" mark (rule 1), toasts (rule 5), the AI
replacing the title (rule 7), colour and estimate fields (RFC decision 2; no estimate field
exists), and the 1.5 s typing-pause trigger (capture still asks on Enter).

**Documents amended with the UI work:** BRAND.md "## AI" rule 3 (the pending card may show a
labelled list and a review footer until kept or undone) and RFC `0005-wallybot-inline.md` §3.3
(fields as a list rather than in their usual places; 15 s; footer). The review panel lists the
new fields as extra rows in its existing groups. New strings go in `de.ts` (authority) and
`en.ts`.

### 6. Answer size and cost

Raise `SUGGESTION_MAX_OUTPUT_TOKENS` so a full answer fits (my call: 1024). The reservation
already counts the instructions, prompt and schema, so the ledger stays correct; the per-call
cost rises with the larger prompt and answer and stays inside the existing daily and monthly
caps.

### 7. Measuring "smarter"

- A fixture set of about 40 realistic English notes, each with a synthetic board context
  (members, tags, properties, other notes) and the fields a person would expect, covering each
  field and the anti-goals (no invented people, no Shared, no private-only tag on a shared
  note, nothing for a plain "call mom"). Stored in the repo as data.
- A scoring script that runs each fixture through the capture path **without Firestore**: the
  prompt builders, the configured runner and the server's filtering and consistency rules, on
  the fixture's synthetic board. It prints, per field, right / wrong / missed, and lists every
  anti-goal failure. It needs Vertex credentials, so **the owner runs it** (agents cannot call
  the real model from a shell), as one documented command.
- Order: the fixtures and the script are the branch's first commit, running against today's
  prompt and answer shape; the owner runs the baseline there. The final run is on the finished
  branch. The fixtures' expected values are written for the new fields; the baseline simply
  scores "missed" on fields today's prompt cannot propose.
- Unit and route tests use recorded model answers to cover the server's filtering, consistency
  rules, keep chain and undo for every new field.

### 8. Verification when the work is done

- All repo checks and guard tests (see the handoff's list) pass locally.
- A live pass on a preview of the branch (`.env.preview`, owner signs in), in **both views**,
  in Paper Wall and Minimal, light and dark, and at a phone width:
  - wall: a fresh note shows "Filling in…", then the rows arrive one by one, the footer counts
    down 15 s, `×` / `↺`, Keep, Undo, Enter and Esc work, Private and the title stay opt-in;
  - **list view** (owner report: "the AI features are not working, at least it looks like it"):
    write a clearly marked test note in the list, confirm the pending row appears where the
    person can see it, its rows and footer are readable, the countdown runs, and keep and Undo work.
    Code reading found no difference in wiring between the views; suspected causes are the row
    jumping to its sorted place out of view, or chips clipped on a one-line row. If it fails,
    it is diagnosed and fixed on this branch before the PR is called ready. The test note is
    deleted afterwards.
- The owner runs the scoring script on the branch and compares with the baseline. Ready means:
  better than the baseline overall and zero anti-goal failures.
- The owner reviews the branch (diff and preview). Only after their OK is it pushed and one PR
  opened against `main`; CI, E2E included, must then be green before it is called ready.

## Left to the builder

- The stored shape for `properties` and `tags` (items with per-item index like `subtasks` and
  `links`), and how a record stored with the old single `reference` is read and decided.
- How the capture card tells a picked column from the New note button's default column.
- Exact wording of the instructions and of the new catalogue strings, within the rules above.
- Whether recent own notes are worth their tokens. With only two owner runs this cannot be
  tuned on the score; include them unless the prompt estimate shows they crowd the budget.
- E2E coverage: CI runs with the assistant off, so a spec that exercises the new chips needs the
  capture response stubbed at the network layer; if that proves impractical, component tests
  carry the UI and the live pass carries the rest.

## Revision 2026-10-19: the review card follows Paper Wall v3

The owner reviewed the preview and rejected the card built under §5: for the most common
proposal (a cleaned title alone) the change was empty, so Keep stayed disabled and nothing
showed; fields lived in two places (typed ones in the meta line, Wallybot's in a block below);
the review block was attached under the card with a visible seam; values were cut off. The
owner's ruling: follow the mockup (`../wally-design/Wally Paper Wall v3.dc.html`, inline card)
and make it clean. This section supersedes §5 and owner's decision 4's "opt-in like the title"
for the title and description; Private stays opt-in.

**Thinking (`asking`).** The card is wrapped in the mockup's animated gradient border (a 1.5px
conic gradient in the accent family turning every 3 s, with a soft warm shadow), the person's
words shimmer, and a "Filling in" label with three pulsing dots sits under them. The done
circle is hidden. No corner dot. Reduced motion: a still gradient, no shimmer, no pulse.

**Review (`pending`), all inside one card.**

- The title shows the cleaned title while it is in the change, and the person's words when
  it is crossed out. The description under it is the proposed one while the title is in the
  change.
- Under a hairline, one row per field: accent dot, label (60px), value, `×`. A crossed-out row
  is struck through at 45% and its button is `↺`. Order: Title, Due, When, Priority, Person,
  Private, properties, tags, related notes.
  - The Title row's value is the cleaned title; crossing it out brings back the person's words
    and takes the description out with it.
  - Fields the person typed (the chips: due date, priority, person) are rows too, with their
    current value and no `×`: they are already on the note.
- Steps follow as a checklist (small square, full text that wraps), each with a `×`/`↺`.
- The footer under a hairline: the ring (ink), "Saves in N s" or "Paused", Undo (outline pill)
  and Keep (primary pill). Keep is always enabled and keeps every row not crossed out; with
  everything crossed out it discards. Enter is Keep, Esc is Undo.
- The countdown keeps the same as Keep, title and description included; only Private is never
  kept by the countdown and starts crossed out.
- The meta line (date, steps count, priority, person) is hidden during review: everything is
  in the rows. Rows and values are never cut to one character; long values wrap.

**One card, one control.** The visual card is a container holding the card's button (title and
words: open, drag) and the review (rows and footer) as siblings, so no control sits inside a
button and there is no seam. The hover lift and the focus ring belong to the whole card.

**After Keep or Undo.** An ordinary card; Undo restores the person's words and fields.

**The list row and the note panel** use the same rows and footer. The panel's two-group
checkbox review ("From what you typed" / "Added by Wallybot") is replaced by the same list.

**BRAND.md "## AI"** is amended: the gradient border and the shimmer while thinking and under
review, the cleaned title shown in place until kept (Undo restores), the ink ring in the footer.

Not taken (owner's choice): a colour proposal, an estimate field, moving the card to its date's
lane at once, a fresh blank card after Enter, the "Keep all / Undo all" bar. The countdown stays
15 s.

## Revision 2026-10-19 (2): editing the text asks again

The owner's request, approved in chat: "it should be possible to edit the card text after AI
improved it, and it should re-trigger the AI", in place on the card "the way I entered the text
in the first place", and in the sidebar too. "Consistency is what we care about and UX is our
first rule": the AI's result looks and moves the same on the card and in the sidebar. Editing an
existing card behaves the same as a new one: the AI runs and its suggestion waits for Keep or Undo.

### Editing in place (wall and list)

- **Start.** Double-click a card's or row's text, or press F2 on a focused card or row. On a card
  under review a single click on its title starts the edit. Only a note the person may edit.
- **The writing card.** The card becomes the capture card's field in place, same spot and width:
  the title (the cleaned title while the Title row is in the change) and, with Shift+Enter or
  when it has one, the description. Typed words become chips exactly as in capture.
- **Finish.** Enter or a click away saves; ⌘/Ctrl+Enter saves and opens the sidebar. Esc puts the
  text back and writes nothing; it never deletes the note. Text identical to what the editor
  opened with, with no chip kept, writes nothing and asks nothing. Both fields erased count as Esc.
- The panel a first click opened stays open beside the edit (one note, two views of it).

### Editing in the sidebar

- The title and description fields show the cleaned text while the Title row is in the change.
- One edit runs from focus entering either field until focus leaves both (or the panel closes).
  Saving as you type is unchanged.

### What a finished edit does (both places)

1. Text unchanged: nothing.
2. Text changed, on the person's own open note, with the assistant on: the waiting suggestion is
   dropped, the note shows "Filling in", and a new suggestion arrives with the 15 s countdown
   (held while the sidebar is open or the card hovered or focused). The call waits for the
   edit's saves to reach the server.
3. The re-ask locks the title, the description and the horizon (horizon stays "fresh note
   only"), plus any field a kept chip set. It proposes only what is still empty; Private stays
   opt-in. Nothing empty: the server answers without a model call.
4. Somebody else's note, a done note, or the assistant off: the edit saves, nothing is asked.

### One look

The sidebar's review uses the card's parts: the moving border around the review, "Filling in"
with the shimmer and dots while the call runs (on the title field too), the same rows and the
same footer (ring, "Saves in N s" / "Paused", Undo, Keep). The "Review" label, its status
sentence and the Keep/Discard pair go.

### Owner's change, same day: the new title is a row

"Reworded" in the review was confusing. The card (and the sidebar's fields) keep the person's own
title and text while a change waits; the Title row shows the new title and a Text row under it
the text moved out of it. Both rows go in and out together. Editing therefore always starts from
the note's own words, on the card and in the sidebar alike. This supersedes "the title shown in
place" from the first revision and "the cleaned title" in the editor and sidebar bullets above.
