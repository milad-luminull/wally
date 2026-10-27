# Wally assistant

**Status:** accepted; the core is live in production since v0.5.0, and the remaining requirements are in §6. MCP (§1) is live since v0.8.3 under [RFC-0004](RFC-0004-wally-mcp.md).
**Last checked:** 2026-10-19, against the local code and running app.

The assistant helps people capture, understand and organize notes on the current board.
The user stays in control. The interaction is defined in
[RFC-0005-wallybot-inline.md](RFC-0005-wallybot-inline.md); external access is a separate, unimplemented
[MCP extension](RFC-0004-wally-mcp.md).

## 1. Current implementation

- Inline capture and editing, suggestions, questions answered on the board, related-note
  links, and explicit Tidy are implemented.
- Questions are read-only. The operation registry supports writes, but this does not mean
  a question can execute them or that every operation has a user-facing assistant flow.
- The model runs inside the existing API through the boundary accepted in
  [ADR-0013](../adr/ADR-0013-model-library-behind-an-owned-boundary.md). The implemented
  providers are Google Vertex and Anthropic through Vertex, using deployment configuration.
- User-supplied provider keys and user model selection are not implemented. MCP connections
  are live since v0.8.3 under [RFC-0004](RFC-0004-wally-mcp.md).

## 2. Product requirements

- Help turn a rough thought into a useful note without blocking normal capture or editing.
- Answer from the caller's current board, show the notes used, and disclose partial results.
- Show proposed changes before applying them. A fresh capture may use the reversible
  countdown described in WALLYBOT_INLINE; edits to existing notes and Tidy need confirmation.
- Follow the user's profile language and interpret dates in the supplied local date/timezone.
- Preserve the minimal board UI and the rules in [BRAND.md](../BRAND.md). Assistance belongs
  on the relevant note or answer card, not in a separate chat product.
- Keep spend bounded, idle infrastructure costs low, and provider-specific code isolated.

## 3. Shared contract

### 3.1 User flows

Capture, inline editing, field-by-field review, board questions and Tidy use the same board
permissions and command layer. See [RFC-0005-wallybot-inline.md](RFC-0005-wallybot-inline.md) for their behavior.

### 3.2 Safety and trust

- **Identity and access:** the server supplies the actor and board. Recheck membership,
  note visibility and the effective deployment/board switch on every request and recovery.
  VIEW members retain their normal rights to their own private notes.
- **Stored approvals:** bind a proposal to its user, board, exact input, base revision and
  operation ids. Execute the stored proposal, not arbitrary input from a client decision.
  Recover pending approvals after reload without applying them; repeated approvals from two
  tabs must execute once. Edited or stale proposals need a new review; never silently retry
  against a newer revision.
- **Confirmation:** fresh-capture countdowns are the limited exception to explicit approval.
  Existing-note changes and moves require a yes. Note deletion, assignment to someone else,
  and making a private note shared require an additional confirmation naming the action.
  **Not built yet:** `riskOf` in [`operations.ts`](../../apps/api/src/lib/assistant/operations.ts)
  classifies these three cases, but only its tests call it; no surface asks for the
  additional confirmation.
- **Recovery:** repeated decisions and lost replies reuse the original operation ids.
  Replay committed outcomes; do not create new actions during recovery. After the seven-day
  receipt window, unresolved writes return to review rather than being resubmitted.
- **Conflicts and undo:** reject stale writes. Undo must not overwrite a later user edit.
  Multi-command changes use each preceding command's returned revision.
- **Attribution:** trusted server context identifies assistant writes in receipts, note
  history and a contents-free audit record committed with the change. The model cannot
  supply or change provenance.
- **Untrusted content:** notes are data, never instructions. Model output is validated;
  returned note references are filtered against what the caller can currently read.
- **Bounded execution:** enforce tool, time, output and spending limits server-side.
  Question turns currently allow 12 tool calls, 6 model steps and 60 seconds. A future
  general write turn must stop after five committed writes across continuations.
- **Budgeting:** reserve an upper bound before each model attempt in a shared ledger;
  enforce a per-user daily token cap and a deployment-key monthly money cap using approved
  prices. Settle actual usage once and retain reservations when usage is unknown. Allow at
  most two concurrent calls per user; a call that ends (answered, failed or timed out) frees
  its slot at once, and an unknown usage keeps only the charge. Disable hidden retries. Caps
  refuse the call and report the reset time.
- **Failures:** distinguish rejection, an uncertain outcome and a committed write whose
  reply failed. Preserve the user's note when enrichment fails, and show failure/refusal
  on the relevant card or control with retry/reset information when applicable.

### 3.3 Operations

The authoritative schemas and annotations are in
[`operations.ts`](../../apps/api/src/lib/assistant/operations.ts). Adapters execute through
[`runOperation`](../../apps/api/src/lib/assistant/run.ts) and the
[board operations contract](../architecture/board-operations.md).

- Reads: `list_notes`, `get_note`, `list_members`.
- Writes: `create_note`, `update_note`, `move_note`, `complete_note`, `reopen_note`,
  `add_subtask`, `toggle_subtask`, `delete_subtask`, `assign_note`, `delete_note`.
- Reads respect private-note visibility; lists are bounded and report truncation.
- Writes use transactional permission checks, revisions and idempotency receipts.
  Assignment is a separate operation. Visibility must be clear in a proposal.
- This registry does not yet cover the full app: board discovery/management, duplication
  and subtask text editing are among the [MCP coverage gaps](RFC-0004-wally-mcp.md#3-tool-coverage).
  Adding an operation or exposing it through a new surface requires an explicit scope decision.

### 3.4 Conversations and data

- A conversation belongs to one user and board, is pinned to its model, and holds messages,
  outcomes and usage. Current limits are 20 turns and 512 KiB of messages, with an expiry
  timestamp 30 days after the last turn.
- Re-read authorized board data for continuations. Previously visible notes must not be
  reused as model context after access is lost. Filter references when returning history.
- The GET routes that returned a stored conversation (`conversations/latest` and
  `conversations/:id`) were removed because no client called them: the turn response
  carries the whole conversation, and nothing restores one after a reload. Pending capture suggestions are still recovered
  (`GET /whiteboards/:id/assistant/suggestions/pending`).
- Treat copied note text and member names as personal data. Do not log their contents or
  credentials. Request date/timezone is transient context.
- Deployment processing stays on the approved Google-hosted route and region. A new
  processor or data route needs the corresponding privacy review and documentation.
- Expiry timestamps do not prove deletion: verify deployment TTL policies and account
  deletion/export coverage. Track outstanding obligations in [GDPR.md](../GDPR.md).

### 3.5 Architecture and verification

Use the existing API, shared schemas, command layer, model boundary and budget ledger.
Do not add a second write path or direct model access to Firestore. Keep provider/library
imports inside the boundary; configuration and Wally-owned types are its public interface.

Use deterministic tests and recorded model responses for CI. Run the live eval before a
model change; tests with recorded responses do not prove the live model's quality.

## 4. Scope boundaries

No autonomous scheduling, cross-board reasoning, reminders, general-purpose chat, direct
model database access, or separate always-on assistant infrastructure. Streaming and other
new experiences need a demonstrated user need, not a speculative roadmap.

## 5. Data protection

Keep [GDPR.md](../GDPR.md) current for conversations, suggestions, audit and usage records,
retention, deletion/export, processors and the privacy notice. These obligations are not
closed by the existence of an assistant route or an expiry field.

## 6. Remaining requirements

- **Own keys and model choice:** let users select a provider/model, save a write-only secret
  outside application data, delete it, and remove it with their account. A failure must never
  fall back to the deployment key. Resolve processing of other members' notes before launch.
- **Broader capture/write requests:** the original multi-item capture and general approved
  write-turn requirements are not supplied by the current read-only question flow. Keep
  them as remaining work, not a description of shipped behavior.
- **Operational/privacy closure:** verify retention enforcement, deletion/export and notices
  against GDPR.md. ADR-0010 is accepted (recorded on 2026-10-27; built since v0.3.3).
