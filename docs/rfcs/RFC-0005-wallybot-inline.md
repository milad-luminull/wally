# Wallybot inline

**Status:** implemented, including smarter capture, inline editing, questions, Tidy and links.
Since the Wally box (2026-11-08, [the box spec](../superpowers/specs/2026-11-08-wally-box-design.md)),
writing starts in the box and its intake decides what a message holds (§3.1, §3.6).
**Last checked:** 2026-11-08, against the current implementation.

This is the interaction reference for the assistant in
[RFC-0003-wally-agent.md](RFC-0003-wally-agent.md). It replaces the earlier question-panel and capture-preview
approach. Keep the existing minimal board design; follow [BRAND.md](../BRAND.md).

## 1. Intent

The user writes and edits directly on the board. Assistance appears where the work happens,
without blocking typing, opening a chat panel or silently rearranging existing notes.

## 2. Interaction rules

User edits win. Proposals are reversible and show their source. Pending styling is temporary;
a kept note returns to its normal appearance. No assistant toasts, color suggestions or
unrequested movement.

## 3. Experience

### 3.1 Write in the Wally box, edit in place

- Writing starts in the Wally box, docked at the bottom centre of every board view. New note,
  `N` and the palette focus it. A double-click on empty wall, or a zone's add action, moves the
  same box to that spot, and a note written there lands there.
- Enter sends and frees the box at once; Shift+Enter is a new line. `⌘/Ctrl+Enter` writes one
  note as typed and opens its details. A note is created when it is sent, not while typing.
- A double-click edits an existing note in place. Keep the detail panel for deliberate
  inspection and structured fields. Preserve focus and the user's words during async work.

### 3.2 Understand while typing

A local parser recognizes supported dates, people and priority words in German and English.
Show matches as removable chips; let the user keep or exclude them before committing.
This requires no model call. Explicitly chosen fields and placement constrain later suggestions.

The parser currently lives in [`src/lib/capture`](../../apps/web/src/lib/capture), not the
shared package assumed in the original proposal.

### 3.3 Suggest after commit

- Suggest supported fields: title, description, due date, horizon, priority, assignee,
  visibility, tags, properties, subtasks and related notes. Validate output and preserve
  fields the user already decided. Low-confidence or inapplicable suggestions are omitted.
- Show a pending card with the person's title and individually reviewable rows. The
  proposed title is a row, not an immediate replacement. Reveal fields without requiring
  a streaming API.
- Fresh-capture enrichment can count down for **15 seconds**. Hover, focus or editing pauses
  review; Enter/Keep applies selected fields and Escape/Undo discards them. A proposal
  assigning someone else waits for the user. Existing-note enrichment never auto-applies.
- **Private is opt-in.** The countdown never changes visibility. The current schema permits
  the cleaned title and description to be kept by the countdown; the older rule making
  those fields opt-in was superseded by smarter capture.
- An edit cancels or invalidates older suggestions. Stale responses must not overwrite it.
  Undo is available for 30 seconds after keep and must preserve later edits.
- Enrichment failure leaves the note as written and says why on the card, with retry or
  reset information when applicable. No toast.

### 3.4 Review and related notes

Review fields individually, with groups for what was typed and what the assistant added.
Subtasks, links, tags and properties can be included or excluded item by item.

Resolve links only to notes the caller can currently see. Related notes are available in
the detail panel; the free canvas also draws hairlines. Do not imply that the list or
zone views draw those lines.

### 3.5 Tidy

Tidy is an explicit action on the horizon board. Show proposed moves first and apply them
only on Enter/Keep, never by a countdown. Undo the batch without overwriting later edits;
skip notes whose access or revision changed. Pending Tidy is not restored after reload.

### 3.6 What a message holds, and questions

When assistance is enabled, one model call (the intake) reads each message with the board's
open notes and returns its items: notes (one or several, in the writer's words), a question, a
note already on the wall, or a short question back for words too vague to act on. No keyword
or `?` rule decides. Before Enter the box shows a local guess ("Adds a note" / "Asks Wally");
Tab flips and pins it, and a pinned choice skips the intake. If the intake fails, a note is
saved as written and a question goes back into the box. When assistance is disabled, every
message is a note.

A question is answered in the box, never on the wall, with readable note references filtered
against current visibility; those cards are briefly marked. Only the latest reply shows; a
message sent while it shows is read as a possible follow-up. Questions are read-only; change
requests explain that limitation. Refusals and failures are said in the box.

### 3.7 Settings

The profile menu exposes **Always ask me**, which disables automatic keeping. The deployment
switch and board owner's switch control availability. Delay controls and per-field opt-outs
from the original proposal are not implemented; do not imply they are available.

## 4. Execution contract

- Store suggestions with the actor, board, note revision, proposed fields and stable
  operation ids. Decisions refer to that record and execute through the shared command layer.
- A capture suggestion uses one validated model response through the model boundary and
  budget ledger. Questions use bounded read tools; Tidy has its own proposal and decision.
- Retries preserve action ids. Reject stale decisions, filter inaccessible related notes,
  record provenance and audit, and make undo conditional on the state it would reverse.
- Timers, selection and field reveals are presentation behavior; the server owns the decision
  and writes. See [RFC-0003-wally-agent.md §3](RFC-0003-wally-agent.md#3-shared-contract).

## 5. Verification

Cover capture and editing, parser chips, countdown/pause, partial keep, stale decisions,
undo after later edits, accessible links, question references and Tidy confirmation.
Use the current controllers, shared schemas and their tests as implementation references:

- [`WallyBox`](../../apps/web/src/features/board/WallyBox),
  [`Capture`](../../apps/web/src/features/board/Capture),
  [`Suggestions`](../../apps/web/src/features/board/Suggestions),
  [`Ask`](../../apps/web/src/features/board/Ask), [`Tidy`](../../apps/web/src/features/board/Tidy).
- [`assistant.ts`](../../packages/shared/src/schemas/assistant.ts) and the API's
  [`assistant`](../../apps/api/src/lib/assistant) modules.
