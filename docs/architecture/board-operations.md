# Board operations

All user board mutations enter `apps/api/src/lib/commands/index.ts`. Queries in `queries.ts`
return authorized snapshots. `routes/boards.ts` supplies authenticated identity and adapts
HTTP, while `packages/shared/src/schemas/command.ts` defines strict application inputs.
Future tools must invoke these functions, never the underlying mutation helpers or Firestore.

| Aggregate                  | Commands                                                                     | Permission                             | Expected revision                         |
| -------------------------- | ---------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------- |
| New note                   | `note.create`                                                                | EDIT or OWNER; any role if private     | None                                      |
| Existing note and subtasks | update, move, assign, complete, reopen, delete; subtask create/update/delete | EDIT or OWNER; any role if own private | Parent note                               |
| Copy                       | `note.duplicate`                                                             | EDIT or OWNER; any role if own private | Source note; source revision is unchanged |
| Board administration       | rename; member invite/update/delete; link create/update/rotate/delete        | OWNER                                  | Board                                     |
| Share redemption           | `link.redeem`                                                                | Authenticated holder of current token  | None                                      |

A member's own private note accepts every note and subtask command from OWNER, EDIT or VIEW, and any member may create a note with `visibility: PRIVATE`; creating a shared note still needs EDIT or OWNER. Changing a note's `visibility`, in either direction, requires EDIT or OWNER and being its creator. Another member's private note answers 404 on reads and commands, before any role check. A private note can be assigned only to its creator. Receipts store the roles that authorized them, and replay re-checks the caller's current role against that set.

Every command requires a UUID `Idempotency-Key`. Existing aggregates also require a
nonnegative integer `X-Expected-Revision`. Successful writes, including 204, return
`X-Resource-Revision`. Note and board DTOs contain `revision`; member and share-link editing
reads return the matching board revision in the header. These headers are exposed by CORS.
New records start at one, legacy records at zero. No-op writes can keep their revision.

The existing `{ error, message }` envelope includes `409 STALE_REVISION`,
`409 IDEMPOTENCY_KEY_REUSED`, `422 PRIVATE_NOTE_NOT_ASSIGNABLE` and `428 PRECONDITION_REQUIRED`. A stale write applies nothing.
The client must preserve the proposed change, display current data, and submit reviewed
changes as a new operation against the exact reviewed revision. Merely fetching a later
revision must never silently rebase an old draft. Note creation and intentional independent
copies each get their own operation ID.

Receipts live at `users/{uid}/boardOperations/{operationId}` with a canonical command hash,
board ID, committed result, creation time and seven-day `expiresAt`. Identical requests,
including concurrent or lost-response retries, return the same result. Replay rechecks the
current role before exposing that result, even when the original target has been deleted.
The API may still replay a receipt awaiting asynchronous TTL deletion; clients must not rely
on retries beyond seven days. The browser blocks expired uncertain retries.

`boardCleanup` holds deletion and member-removal jobs without TTL. A tombstoned note is
hidden before physical recursive deletion. A retry or maintenance run resumes outstanding
work. Assignment cleanup reads each candidate again with current board access, preserving
reassignments and rejoined members, and increments changed note revisions. Copying more
than 400 subtasks fails with `422 COPY_TOO_LARGE` before any writes; database transaction
limits also fail atomically.

The web client's `mutationQueue.ts` scopes work to the current authentication generation.
It stores only locally acknowledged revision transitions, pins uncertain retries and delayed
deletions, and blocks a lane after failure. `noteDrafts.ts` keeps text outside server caches;
`MutationRecovery.tsx` offers review, apply, keep and discard in both supported languages.
State is in memory: reload closes the session's drafts, so resolve or copy them before reload.
Account changes intentionally clear it. `useSessionMutation.ts` guards cache callbacks from
old accounts. Optimistic rollback restores only the failed operation's owned fields.

Commands log type, operation ID, board ID and outcome (`committed`, `replayed`, error code or
`cleanup_pending`), never command inputs or results. Redemption URLs redact the token.
Maintenance reports counts only. See [deployment guidance](../DEPLOY.md#board-safety-rollout)
and the [data inventory](../GDPR.md#mutation-receipts-and-cleanup-jobs).
