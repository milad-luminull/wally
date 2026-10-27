# Wallybot inline

**Status:** implemented, including smarter capture, inline editing, questions, Tidy and links.
**Last checked:** 2026-10-19, against the current implementation.

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

### 3.1 Write and edit in place

- New note, `N`, and the board's placement actions start a focused card or list row.
  A draft is created optimistically as typing begins; Enter or leaving the card commits it.
  Shift+Enter adds a description; an empty capture can be dismissed. `⌘/Ctrl+Enter` opens details.
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

### 3.6 Questions

When assistance is enabled, committing a capture title ending in `?` asks the current board.
The draft gives way to an answer card with readable note references. Questions are read-only;
change requests explain that limitation. When assistance is disabled, the text is a normal note.

Answers fade after reading time unless pinned. Hover and focus pause fading. Filter note
references against current visibility. Show refusals and failures on the card. Preserve
focus when the card appears or disappears; do not reopen the retired question panel.

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

- [`Capture`](../../apps/web/src/features/board/Capture),
  [`Suggestions`](../../apps/web/src/features/board/Suggestions),
  [`Ask`](../../apps/web/src/features/board/Ask), [`Tidy`](../../apps/web/src/features/board/Tidy).
- [`assistant.ts`](../../packages/shared/src/schemas/assistant.ts) and the API's
  [`assistant`](../../apps/api/src/lib/assistant) modules.
