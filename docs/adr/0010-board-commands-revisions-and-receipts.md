# ADR-0010: Board commands use transactional permissions, revisions and receipts

- **Status:** proposed
- **Date:** 2026-10-12
- **Deciders:** pending review

## Context and problem statement

Board writes previously combined route-specific authorization with separate record reads and
writes. A permission could change after it was checked, concurrent edits could overwrite each
other, and retrying a lost response could create duplicate notes or history. Future adapters
must inherit the same protections as the browser. This foundation does not introduce an LLM
provider, MCP endpoint, OAuth server or assistant.

## Considered options

1. Keep validation and authorization in REST handlers and add timestamp checks per route.
   This duplicates policy for future adapters and does not provide an atomic retry result.
2. Introduce an orchestration service or distributed lock for all writes. This adds another
   service and failure boundary without replacing database authorization or concurrency checks.
3. Use shared application commands with Firestore transactions, integer aggregate revisions
   and caller-scoped idempotency receipts.

## Decision outcome

Choose shared commands. REST authenticates and adapts transport. `executeBoardCommand`
validates the command, reads permissions and targets inside the transaction, checks the
expected revision, and commits the mutation with its receipt. VIEW reads; EDIT manages
notes and subtasks; OWNER additionally manages board settings, memberships and links.

Notes are aggregates with their subtasks. Substantive changes advance the note revision.
Board administration and automatic invitation activation advance the board revision; note
edits do not. Missing legacy revisions mean zero; new records start at one. No-op completion
preserves the original completion time. Data and revision used for editing come from the
same read snapshot.

Receipts are scoped to the authenticated user and fingerprint the validated command and
expected revision. A retry returns the stored result only after checking current access.
Receipts are read before target existence, allowing retries after physical deletion. A
seven-day Firestore TTL defines the supported retry window. Copies commit atomically and
have an application limit of 400 subtasks; larger copies publish nothing.

Deletion commits a tombstone and durable cleanup job with the receipt. Cleanup attempts run
synchronously and remain resumable. Assignment cleanup rechecks current access and assignee
inside each note transaction. Pending jobs never expire with receipts.

The browser serializes mutations per aggregate, advances queued versions only from local
acknowledgments, and keeps drafts separate from server data. Conflicts stop the queue and
require review; applying reviewed changes creates a new action. Account changes abort
requests and clear pending state.

### Consequences

- Good: REST and future adapters share the same permission, lifecycle and retry contract.
- Good: concurrent writes fail explicitly and failed cleanup cannot make a deleted note visible.
- Bad: transactions add reads and contention; receipts temporarily duplicate sensitive result data.
- Bad: clients must ship with the enforced API contract. Older tabs cannot write until refreshed.
- Neutral: seven days is a supported retry window, not an exact physical deletion deadline;
  Firestore TTL deletion is asynchronous.

### Confirmation

Emulator tests exercise role/scope checks, stale writes, replay, invitation/link races,
legacy records, atomic copies and cleanup. Browser tests exercise queues, draft review,
autosave acknowledgments, rollback, delayed actions and account cancellation.

## More information

- [Command contract](../architecture/board-operations.md)
- [Rollout and maintenance](../DEPLOY.md#board-safety-rollout)
- [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions)
- [Firestore TTL](https://firebase.google.com/docs/firestore/ttl)
