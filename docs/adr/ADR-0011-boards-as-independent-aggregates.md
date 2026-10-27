# ADR-0011: Boards as independent aggregates: several per owner, deletable, with a tombstone

- **Status:** accepted (recorded on 2026-10-27: built and live since v0.4.0; the status had not been updated)
- **Date:** 2026-10-14
- **Deciders:** Milad Rezazadeh
- **Supersedes:** ADR-0004, in part: the rule that the board's document id is the owner's uid, so "one whiteboard per owner" is a property of the key space

## Context and problem statement

ADR-0004 made "one whiteboard per owner" a property of the key space: the board's document id was the owner's uid, and the auth hook recreated that board whenever it was missing. The board home ([RFC BOARD_HOME](../rfcs/RFC-0002-board-home.md), approved 2026-10-14) needs a user to own several boards, delete one, and leave a shared one. How are boards created, identified and deleted once there can be more than one per owner?

## Considered options

1. **Generated ids for new boards, the first board keeps the uid, deletion by tombstone and cleanup job:** good, because no stored data moves and deletion follows the note pattern of ADR-0010; bad, because the uid-keyed first board stays a historical special case in the data, if not in the code.
2. **Migrate every board to a generated id:** good, because one id scheme; bad, because a migration of every board, every note's `whiteboardId`, every member row and every remembered preference, for no user-visible gain.
3. **Hard delete in the command transaction:** good, because no tombstone; bad, because a board's notes are unbounded and do not fit one transaction, so a failure would leave orphans.

## Decision outcome

Chosen option: **generated ids, the first board keeps the uid, tombstone and cleanup job.**

- `board.create` creates a board with a generated id, owned by the caller, up to `MAX_OWN_BOARDS` live boards.
- The auth hook creates the first board only together with a new user record. A user who deleted their last board stays at zero boards.
- `board.delete` sets `deletedAt`, removes the share link and enqueues a `board.delete` job in the same commit. `liveWhiteboard` in [`apps/api/src/lib/db/collections.ts`](../../apps/api/src/lib/db/collections.ts) treats a tombstoned board as missing; every query, command and access check reads boards through it. The job deletes the notes recursively, then the board with its members, and is resumable by maintenance.
- `board.leave` removes the caller's own membership without an expected revision and reuses the `member.remove` cleanup.

### Consequences

- Good: no migration; existing boards, notes and preferences are untouched.
- Good: a deleted board is a 404 for everyone from the commit on, exactly like a board the caller never belonged to.
- Bad: a retry of `board.delete` or `board.leave` after it succeeded answers 404, not the stored result, because replay rechecks access first. The web client treats that 404 as success.
- Bad: a user record removed by hand no longer gets a board back; only a brand-new identity is provisioned one.
- Neutral: account erasure (GDPR GAP-01) can now reuse `board.delete` for the user's own boards.

### Confirmation

`apps/api/test/boards-lifecycle.test.ts` covers create, delete, cleanup failure and resumption, and leave. `apps/api/test/whiteboards.test.ts` and `apps/api/src/lib/authorization.test.ts` cover the tombstone; `apps/api/test/me.test.ts` covers provisioning.

## More information

- Command table and cleanup kinds: [Board operations](../architecture/board-operations.md).
- Product behaviour: [`SPEC.md` §4b](../SPEC.md).
