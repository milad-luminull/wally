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
- "Smarter" is measured on a fixed set of sample notes, before and after.
- Capture in the list view is verified working end to end once the work is done.

## Non-goals

- No model change. The deployment stays on `vertex:gemini-2.5-flash` in the EU with thinking
  off (`suggestionCallSettings`). Owner's decision: better instructions and context first. If
  the sample set shows the model is the limit, that is a later, separate decision.
- No new screens, settings, buttons or layout. New fields use the existing proposed-field chip
  (`ProposedField`), the existing review rows (`PendingReview`) and the existing keep / `×` /
  Esc / Undo behaviour.
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

- RFC `docs/rfcs/WALLYBOT_INLINE.md` §3.3–3.4 and §7 stand: no modal, no toast, never overwrite
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
- Codex is working on `codex/paper-wall-uplift`, which also touches `AppShell.tsx`,
  `WallView/NoteCard.tsx` and the `de.ts` / `en.ts` catalogues. Keep edits in those files small
  and expect to rebase on whichever lands first.

## Owner's decisions

1. **Model:** unchanged (see Non-goals).
2. **Countdown:** 15 s (`COUNTDOWN_MS` in `apps/web/src/features/board/Suggestions/useSuggestions.ts`,
   and every test and doc line that states 6 s). Hover/focus still pauses it; Esc still discards;
   `×` still drops one field; Undo still holds for 30 s after a keep.
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

## The design

### 1. The instructions change from "copy" to "understand"

Rewrite `CAPTURE_INSTRUCTIONS_PREFIX` around one rule: *fill in what a capable assistant would
set for this task, inferring from the words, the board and common sense; never invent a fact
the words and board do not support.* Each field's line says what counts as a signal. The
confidence and reason contract stays (reason ≤ ten words, quoting or naming the signal, in the
answer language). Byte-stability for caching stays: board content goes in the prompt, never in
the instructions.

Per field (existing ones get smarter, new ones are added):

| Field | Today | After |
|---|---|---|
| `dueDate` | exact dates only | deadlines stated or clearly implied ("by Friday", "before the 3rd", "end of month", "EOD"). Vague spans ("this week", "next week", "soon") go to `horizon`, not to a made-up date. |
| `horizon` *(new)* | — | `DIESE_WOCHE` or `SPAETER` from timing words or from a proposed date's distance (this week → This week; later → Later). Never `HEUTE`: that is the default and so proposes nothing. |
| `priority` | urgent/defer keywords | judged from stakes and timing: a near deadline with an outside party, a blocker, an escalation → `HOCH`; "when there's time", "nice to have", someday → `NIEDRIG`; ordinary tasks → none. |
| `assignee` | a named member | also "ask Anna to…", "Anna sends…", "@anna"; still only ids from the member list. |
| `visibility` *(new)* | — | `PRIVATE` for clearly personal matters (health, family, personal money, salary, own job applications, a gift for a colleague) or explicit "private", "just for me". Nothing else. |
| `title` | shorter, identical meaning | a clean title when the typed one is long, rambling, or still carries words that became fields ("Call Anna tomorrow urgent" → "Call Anna"). Opt-in as today (R2). |
| `description` *(new)* | — | when the typed title carries detail beyond a title, the detail moves here and `title` is the short form. Proposed only while the note has no description. Opt-in with the title (R2): never kept by the countdown. |
| `properties` *(replaces the single `reference`)* | one property | up to three, e.g. Customer, Project, Contract number; reuse board keys and, where the value matches one already used, its spelling. |
| `tags` *(new)* | — | up to three; prefer the board's existing tags; a new tag only for a clear category. |
| `subtasks` | only when listed | also for tasks that naturally have steps ("prepare board meeting"), two to five concrete steps; none for single-action tasks ("call mom"). |
| `links` | as merged in PR #57/#58 | unchanged. |

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

The only visible changes:

- the countdown is 15 s;
- the pending card and the list row show chips for the new fields, in the place each field has
  on a normal card, using `ProposedField` and new catalogue strings (de authority, en mirror);
  Private uses the toggle form the offered title already uses (`aria-pressed`, unticked until
  the person ticks it);
- the review panel lists the same fields as extra rows in its existing groups.

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

- All repo checks and guard tests (see the handoff's list), then CI green, E2E included.
- A live pass on a preview of the branch (`.env.preview`, owner signs in), in **both views**:
  - wall: a fresh note shows the new chips, the countdown runs 15 s, keep / `×` / Esc / Undo work;
  - **list view** (owner report: "the AI features are not working, at least it looks like it"):
    write a clearly marked test note in the list, confirm the pending row appears where the
    person can see it, its chips are readable, the countdown runs, and keep and Undo work.
    Code reading found no difference in wiring between the views; suspected causes are the row
    jumping to its sorted place out of view, or chips clipped on a one-line row. If it fails,
    it is diagnosed and fixed on this branch before the PR is called ready. The test note is
    deleted afterwards.
- The owner runs the scoring script on the branch and compares with the baseline. Ready means:
  better than the baseline overall and zero anti-goal failures.

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
