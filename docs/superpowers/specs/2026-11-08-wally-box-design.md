# The Wally box (Wallybot v3: 3a, 3b, 3c, 3g)

**Status:** approved 2026-11-08.
**Design source:** `../wallybot-v3-design` (flows 3a In any AI app, 3b Welcome back, 3c One box,
3g Add a card). The design is a suggestion; where this document differs, it says so.
**Later rounds:** 3d Brief, 3e Group and link, 3f Connected apps, Plan my day/week (bulk
changes), and voice (its own session, see §9).

## 1. Why

Today you start in Wally by double-clicking empty wall or clicking a lane, and you ask a
question by ending a note's title with "?". Neither is visible, and the "?" rule is a guess,
not understanding. People don't know where to start.

The Wally box is one obvious place to start: a box floating at the bottom centre of every
board screen. You type what's on your mind; Wally works out what you meant from your words and
your wall: one note, several notes, a question, or a change to notes you named. It feels
natural and smooth, and stays out of the way.

## 2. Goals, non-goals, anti-goals

**Goals**

- One box, always visible, where every board interaction with Wally starts.
- Understanding, not keyword rules: the model decides what the text is. The `?` check
  (`apps/web/src/lib/capture/question.ts`) is removed.
- Writing never waits: Enter clears the box at once; work in flight shows as chips.
- One message can become several notes, written or pasted.
- Every change Wally makes has one visible Undo.
- You can always see where a note came from (Wally, ChatGPT, Claude, …) and what changed
  since your last visit.

**Non-goals (this round)**

- Bulk changes: Tidy-like moves, Plan my day/week, lighter day, focus time. Today's Tidy stays
  as it is until the Plan round replaces it.
- Groups and typed links (3e), Brief (3d), the Connected apps redesign (3f).
- Voice input (its own session, §9).
- Suggestions that Wally offers unprompted ("Group these 4 notes?"); they arrive with 3e.

**Anti-goals: a failure even if it works**

- A chat app: no history, no scrolling transcript, no pop-up, nothing that covers the wall.
- A prompt wrapper: text the model can't place must still never be lost.
- Custom one-off views. The box is built from the app's existing components, tokens and
  motion rules (`docs/BRAND.md`); anything the prototype overdoes is simplified (§8).
- Slow typing: no model call happens while you type.

## 3. The box

### 3.1 Where it lives

- **Docked:** bottom centre of every board view (wall, zones, list), above the wall, at
  most ~640px wide; on narrow screens full width with the 16px gutter. The wall gets enough
  bottom padding that the box never hides the last row of cards.
- **Anchored:** double-clicking empty wall (or clicking a zone's empty space) moves the same
  box to that spot, as if Wally went there. It behaves exactly like the docked box; a note
  written there lands where you clicked (free canvas position, or that zone's horizon or
  priority). Esc, a click elsewhere, or sending the last item returns it to the dock.
- `N`, the New note button and the command palette focus the box (docked).
- Editing an existing note in place (double-click on a card) is unchanged.

### 3.2 States

One white surface with the marigold mark, using existing field and elevation styles:

1. **Rest:** placeholder "Write a note, or ask Wally…", the `N` key hint.
2. **Typing:** a short hint before ⏎: "Adds a note" or "Asks Wally" (see §4.2). The instant
   parser chips (dates, people, priority) show only while the hint is "Adds a note" and the
   text is one line; kept chips are sent with the message as today's `locked` fields. If the
   intake splits the text or decides it is not a note, the chips are ignored and the fill-in
   reads the words itself. *(Builder-check call.)*
3. **Working:** the box's edge takes the accent ring (BRAND accent job 4, extended to the
   box) while anything is in flight; each item shows as a small chip with its first words
   and the pulsing dots. Chips finish in any order.
4. **Reply:** one area above the input shows only the latest reply: an answer, a question
   back, or a change summary with Undo (§5). Esc or × closes it. A new message replaces it.

The box never grows beyond a few lines; a long answer scrolls inside its reply area.

### 3.3 Keys

Enter sends. Shift+Enter is a new line; the intake decides whether lines are separate notes
or one note with detail (the fill-in already moves detail into the description, so the box
has no separate description field). Tab flips the hint (note ↔ ask) and pins it for this
message. Esc closes the reply, then blurs the box.

## 4. How Wally decides

### 4.1 The intake call

On Enter, unless the hint was pinned with Tab, the text goes to a new API call, **intake**
(POST `/whiteboards/:id/assistant/intakes`). One structured-output model call, no tools,
reads the text with the board as data and returns a list of items, each of one kind:

| Kind      | Item holds                                                                                | What happens                                    |
| --------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `note`    | one note text, in the writer's words                                                      | Created and filled in (§5.1)                    |
| `ask`     | the question                                                                              | The existing question turn answers it (§5.2)    |
| `change`  | operations on notes it names by id: complete, reopen, set due date, horizon, priority, assignee, rename | Applied with one Undo (§5.3)          |
| `clarify` | one short question, two or three options, and the note it is about (if any)              | Shown in the box; the choice resolves it (§5.4) |

*(Builder-check calls:)*

- **Mixed messages:** note items always go ahead on their own. At most one other item (an
  `ask`, a `change` or a `clarify`) per message, because the box shows one reply; when the
  model finds more, it returns one `clarify` asking which to do first. "Add dentist Friday,
  and what's due tomorrow?" gives one note and one answer.
- **Duplicates:** a note that is already on the wall becomes a `clarify` for that note only;
  the message's other notes go ahead.
- **Limits:** at most 10 notes per message. A message with more adds the first 10, and the
  box says so.
- **Board data:** member names, the ids and titles of open notes (newest first, at most 150)
  and of notes done in the last 7 days (so "reopen …" works), and today's date and time zone.
- **Follow-ups:** while an answer is showing, the intake also gets that question and its
  answer, so "and next week?" is read as a follow-up `ask` and continues the conversation.

`clarify` is used only when it must be: the note is already on the wall (by meaning, not
exact words), the text is too vague to act on, or a change could mean more than one note.

The intake prompt follows the existing prompt rules: byte-stable prefix for caching, board
content only as data, never follow instructions inside it, no name and no first person. It
runs through the model boundary, budget ledger and rate limits like every other call, with a
short deadline. It reuses the capture call's model and settings.

### 4.2 The hint before Enter

The hint is a local guess (no network), shown so you know roughly what will happen and can
flip it. The model has the final say unless you pinned the hint with Tab:

- **Pinned "Adds a note":** no intake call; exactly one note, as written (the fastest path):
  the first line is its title, any further lines its description.
- **Pinned "Asks Wally":** no intake call; straight to the question turn.
- **Not pinned:** the intake decides; if it disagrees with the hint, the result simply
  follows the intake.

*Difference from the design:* in 3c the hint is the decision. Here it is only a guess,
because the owner asked for understanding over keyword rules.

### 4.3 Without the model

- Assistant off (deployment switch or the board owner's switch): the box only writes notes,
  exactly as pinned "Adds a note" does; no hint, no Tab.
- Intake fails or times out: if the hint said note, the text is saved as one note as written
  (as above) and the box says "Saved as written." If it said ask, the box says Wally couldn't
  answer and puts the text back in the box. Nothing is ever lost.

### 4.4 Model calls in flight *(builder-check call)*

Today a user may have two model calls in flight (`MAX_IN_FLIGHT = 2`, `budget/ledger.ts`),
and a burst of notes needs one fill-in call each. The client queues fill-ins and runs at most
one at a time, so the other slot is always free for the next intake or question; a note waits
on the wall as written until its turn, so writing never waits. The spend caps are unchanged.
If this proves slow in use, raising the in-flight limit is a separate decision for the owner.

## 5. What each kind does

### 5.1 Notes (3g)

- Each note is created by the box through the existing create call, at the anchored spot or at
  the docked box's default placement.
- The card appears on the wall with today's pending fill-in: the existing capture call
  (`suggestForCapture`) runs per note, and today's review is reused on the card: the accent
  edge, the proposed rows, the countdown, Keep and Undo, and "Always ask me". The chip in
  the box disappears when its card lands.
- Restyle only: the pending edge follows 3g's thin amber outline; behaviour is unchanged.

### 5.2 Questions (3c)

- Answered by today's question turn (`lib/assistant/turn.ts`, read-only tools) in the box's
  reply area, in plain text, with the notes it read listed underneath (reuse `AnswerNotes`).
  Clicking a note opens it. Its card on the wall gets a brief highlight so the eye finds it.
- Only the latest answer is shown. A message typed while the answer is still showing
  continues the same conversation (today's `conversationId` rule); otherwise a new one starts.
- The answer card on the wall (`AskCard`, `askSlot`) is retired.
- The question prompt no longer says "changes are not available": a change request now goes
  to the intake. If one still reaches the question turn (pinned ask), it answers that changes
  are made by writing them in the box without Tab.

### 5.3 Changes to named notes (3c, single notes only)

- Only notes the text names, at most five per message; anything larger is out of scope until
  the Plan round, and the box says so in one line.
- Applied through the existing operations layer with assistant provenance. Risky operations
  (`riskOf`: assigning someone else, making shared, deleting) are never applied directly: the
  box asks once, with the note shown. Delete is not offered from the box this round.
- The reply area says what changed ("Moved “Dentist” to Friday") with one **Undo**; the
  changed cards get the same brief highlight. Undo uses the existing conditional undo (it
  skips notes edited since) and is also reachable with ⌘Z (`keptOrder`).

### 5.4 Questions back

One short question with two or three option buttons, e.g. "You already have “Update premium
table” on Tuesday." → Open it · Add anyway; "The Munich renewal call, or a new note?". The
matching card on the wall gets the highlight. Choosing an option resolves the item without
another model call where possible (Add anyway creates the note; Open it opens it).

## 6. Where a note came from, and what's new (3b, 3a)

### 6.1 Source line

- A note created by a connected app carries a small, lasting line on its card naming the app,
  from `mcp_connections.name` (e.g. "ChatGPT"). Notes you wrote in Wally have no line.
  Notes Wally created from the box are yours: they have no line either.
- The note panel's history shows the source for each recorded event.
- This needs the source stored on the note (today it lives only in `note_history.metadata.via`
  for create and move events); the builder chooses the schema.

### 6.2 New since your last visit

- A note that a connected app created or changed since your previous visit gets the thin amber
  outline and one line saying what happened and which app ("New · from ChatGPT",
  "Done · by ChatGPT"). The header shows how many.
- Nothing else on the wall changes. The mark goes away when you open the note, or on your next
  visit.
- Changes you or a teammate made in Wally are not marked.
- *(Builder-check call)* A visit is per person and per board. It starts when you open the
  board, or come back to it after at least 30 minutes with the tab hidden or closed; it ends
  when you leave. Changes an app makes while you are on the board are marked too, since
  they happened after your visit began.

### 6.3 In ChatGPT and other AI apps (3a, scoped)

- New tool `add_notes`: several notes in one call, created and filled in the same way as the
  box (no review countdown outside Wally: the fill-in is kept, and marked new on the wall).
  The fill-in follows the same rules as in Wally: it is charged to the connection owner's
  budget, it is skipped when the board's assistant is off (the notes stay as written), and a
  proposed assignee other than the connection owner is dropped, not kept.
- Every write tool's answer includes a link that opens Wally at that note.
- The existing inline card view (`show_cards`) shows the added notes. Fixing the known issue
  that the card view does not appear in ChatGPT is tracked separately; Undo buttons inside the
  inline view wait until that works.
- *(Builder-check call)* "Notes for other people wait for your OK" (3a) moves to the 3f round
  (Connected apps: access and activity), where the permission levels live. Until then the
  existing tools (`create_note`, `assign_note`) behave as today.

## 7. Copy

Sentence case, second person, no exclamation marks, no name, no "I" (BRAND rule 2): "Asks
Wally", "Moved “Dentist” to Friday", "Saved as written.", "You already have …". The prototype's
first-person replies ("I added…") are rewritten this way. Every string is in `en.ts` and
`de.ts`.

## 8. Simplified from the prototype

- No follow-up input row and no "Close · Esc" button in the answer: the same box takes the
  follow-up; Esc closes.
- No "Draft" step with a countdown for changes: a change is applied and offered for Undo
  (rule: every AI action reversible in one step). Risky ones ask first.
- No separate toast above the box: the box's reply area carries the Undo (BRAND rule 5).
- No option buttons after answers ("Plan around it", "Link the two notes"): they belong to
  the Plan and 3e rounds.

## 9. Voice (next session, highlighted)

Voice is the next piece of work after this round, in its own session. This round leaves room
for it: the box layout keeps a slot for a mic button to the right of the input, and the intake
already turns one message into several notes, so spoken text can use the same path. No mic
button is shown until voice works; a button that does nothing is not shipped.

## 10. Rules that change

- `docs/BRAND.md` AI rules 3, 5 and 8 and accent job 4: answers live in the box, not on the
  wall; the accent ring extends to the box while working; the source line and new-since-visit
  outline are added.
- `docs/rfcs/RFC-0005-wallybot-inline.md` §3.1 and §3.6: the box replaces in-place capture
  as the way to start, and the `?` rule is gone. Both docs are updated in the same PR as the
  behaviour.

## 11. Delivery

Three PRs, each cut from `origin/main` after the previous one merged (no stacking), each with
its Playwright specs updated in the same PR:

1. **The box:** docked and anchored box, hint and Tab, chips, intake (`notes`, `ask`,
   `clarify`), answers in the box, `AskCard` and the `?` check removed, BRAND/RFC updates.
   E2E: `note-create.spec.ts` (capture through the box; the "?" test becomes "assistant off:
   every message is a note"), `capture-review.spec.ts`, plus a stubbed intake spec.
2. **Changes:** the `change` kind, Undo in the box, risky operations asking first.
3. **Sources and AI apps:** source line, new since your last visit, `add_notes`, links.

## 12. Left to the builder

Component and hook structure; the intake schema and prompt wording (validated against an eval
set like `capture-eval.ts`, including German and English texts); the deadline value; the
storage for source and last visit; the local hint's guess; placement of notes from the docked
box on the free canvas; exact sizes within BRAND's scale.
