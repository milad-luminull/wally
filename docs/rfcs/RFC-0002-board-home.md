# Board home and multiple boards — requirements

**Status:** approved 2026-10-14; live in production since v0.4.0. §5 to §12 now live in
[`SPEC.md` §4b](../SPEC.md) and [ADR-0011](../adr/ADR-0011-boards-as-independent-aggregates.md);
this file is kept for the reasoning and the alternatives considered. One deviation:
`board.create` has no per-route rate limit (§12.1 said "like invites"); `MAX_OWN_BOARDS` and
the global limit bound it.
**Last revised:** 2026-10-14.

Read next to [`SPEC.md`](../SPEC.md) (the accepted product requirements this extends) and
[Board operations](../architecture/board-operations.md) (the command layer every write
below goes through). Once approved, §5 to §12 move into `SPEC.md`, §14 of `SPEC.md` drops
"multiple whiteboards per user", and this file is marked outdated, as
[`docs/README.md`](../README.md) asks.

---

## 1. Outcome

A signed-in user always lands somewhere that is theirs. They can see every board they can
open, own and shared, in one place; they can create more boards of their own, delete a board
they own, and leave a board they were invited to. Signing out and signing in as somebody
else on the same browser never shows a 404.

Three things exist afterwards that do not exist today: a board home page, a "new board"
action, and the two ways out of a board (delete, leave). Everything inside a board behaves
as it does now.

## 2. Why, and why now

### 2.1 The bug

Today `/` sends the caller to the board they last opened, falling back to the board they own
(`RootRedirect.tsx`; this now lives at `/app` in
[`BoardEntryPage.tsx`](../../apps/web/src/routes/BoardEntryPage.tsx)). That part is correct: the
remembered board is stored per user on the profile and checked against the user's own board
list before it is used.

The 404 comes from somewhere else. When a signed-in user signs out while on a board, the
protected route redirects to the login page and attaches the board's path as the place to
return to ([`ProtectedRoute.tsx`](../../apps/web/src/features/auth/ProtectedRoute.tsx),
`state.from`). The login page and the sign-in form then send whoever signs in next to that
path ([`LoginPage.tsx`](../../apps/web/src/routes/LoginPage.tsx),
[`SignInForm.tsx`](../../apps/web/src/features/auth/SignInForm.tsx)). If that is a different
person, the API hides the first person's board from them as 404
([`authorization.ts`](../../apps/api/src/lib/authorization.ts), `requireWhiteboardAccess`),
and the board page shows the not-found screen.

Two separate mistakes: a return path survives a sign-out it does not belong to, and a return
path is trusted without checking whether the new caller can reach it. §5 fixes both.

### 2.2 The missing feature

The bug is a symptom. The app has no page that answers "which boards do I have?":

- `/` never shows a choice; it always jumps into one board.
- The only list of boards is the switcher popover in the top bar
  ([`BoardSwitcher.tsx`](../../apps/web/src/features/board/BoardSwitcher.tsx)), which renders
  nothing until the user has at least two boards, so a person with one board has no hint
  that boards are a thing at all.
- A user cannot create a second board of their own. "One whiteboard per owner" is a property
  of the key space: the board's document id is the owner's uid, and the auth hook recreates
  that board whenever it is missing
  ([`plugins/auth.ts`](../../apps/api/src/plugins/auth.ts), `provisionUser`).
- A user cannot delete a board, and an invited member cannot leave one. The only way off a
  shared board is to ask its owner.

Everything in this document follows from giving the user a home for their boards and the
three operations that make such a home honest: create, delete, leave.

## 3. Decisions

Six questions change the shape of the feature. They were asked and answered on 2026-10-14;
the rest of this document follows from them.

| Question                                                      | Decision                                                                                                                         | Alternatives considered                                                                                                                                                                               |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| May a user create more than one board of their own?           | **Yes.** `board.create`, `board.delete`, and a change to provisioning (§8, §9, §12).                                             | _One own board plus invited boards_: smaller, keeps "board id = uid". Rejected: the home page would list boards the user cannot add to or remove, and the product owner wants separate work contexts. |
| Where does a user with two or more boards land after sign-in? | **On the board home**, every time (§6).                                                                                          | _Last opened board, home as fallback_: one click less per day, but the last board is a guess and an invisible one. Rejected by the product owner in favour of a predictable landing.                  |
| Where does a user with exactly one board land?                | **Straight into that board.** The home is one click away in the top bar (§6, §11).                                               | _The home, always_: one rule for everyone, one extra click for every new sign-up. Rejected.                                                                                                           |
| May an invited member leave a shared board themselves?        | **Yes.** `board.leave` (§10).                                                                                                    | _Owner-managed only_: less work; a home page that lists boards you cannot get rid of. Rejected.                                                                                                       |
| Where does the first board of a new user come from?           | **Created with the user record, as today**, and still keyed by the uid. Only the "recreate when missing" behaviour goes (§12.3). | _Create nothing, show the empty home_: cleaner key space, but every new user starts with an extra step before their first note. Rejected: the first note matters more than the key space.             |
| Does a user have to keep at least one board?                  | **No.** Zero boards is a valid state and the home shows an empty state with the create action (§7.4).                            | _Refuse to delete the last board_: avoids the empty state, but adds a rule the user has to discover by being refused. Rejected.                                                                       |

Decisions taken in this document without a question, because one option is clearly the one
a product designer would choose; each is explained where it appears:

- The landing resolver and the home are two routes, `/` and `/boards` (§6). The home is
  therefore bookmarkable and never bounces the user away.
- The remembered last board stays on the profile and becomes a "continue" hint on the home
  rather than a redirect target (§7.2).
- A board is deleted from the home, after a confirmation that names the board and says how
  many notes go with it (§9). There is no archive.
- `board.leave` needs no expected revision; `board.delete` needs the board's (§12.1).
- A user may own at most `MAX_OWN_BOARDS = 20` boards (§12.4).

## 4. Vocabulary

- **Own board**: a board whose `ownerId` is the caller. Role OWNER.
- **Shared board**: a board where the caller is an ACTIVE member with role EDIT or VIEW.
- **First board**: the board provisioned together with the user record; its id is the uid.
  Nothing else about it is special, and it can be renamed or deleted like any other.
- **Landing**: the route `/`. It decides where a signed-in caller goes and shows nothing
  itself.
- **Home**: the route `/boards`. The page that lists every board the caller can open.

## 5. Sign-out, sign-in and the return path

1. Signing out leaves the user on the login page **with no return path**. The sign-out
   action clears the return path before the auth state changes, so the protected-route
   redirect never captures the board the previous account was on.
2. The login page and sign-in form keep honouring a return path for the two cases it exists
   for: a share link (`/share/:token`) the visitor arrived with, and a board link
   (`/boards/:id`) a signed-out visitor opened. Both are set by the protected-route
   redirect at initial load, as today.
3. After sign-in the form navigates to the landing (`/`) and passes the return path to it.
   The landing applies it only once the caller's board list has loaded: a share link is
   followed as is; a board path is followed if the board is in the list; anything else is
   dropped and the ordinary landing rule (§6) applies.
4. Consequence: a board route that 404s is reachable only by typing or following a stale
   link, never as the result of signing in. The not-found page's button reads "Back to
   your boards" and goes to `/`.

## 6. Landing rule

The landing (`/`) waits for the board list and the profile, as `RootRedirect` does today,
then:

| Boards the caller can open | Goes to                                  |
| -------------------------- | ---------------------------------------- |
| 0                          | `/boards` (the home, in its empty state) |
| 1                          | `/boards/:id` of that one board          |
| 2 or more                  | `/boards` (the home)                     |

Loading and error states stay as they are: the skeleton while loading, the "could not be
loaded" state with a retry button on failure.

The home (`/boards`) never redirects. A single-board user who opens it from the top bar sees
their one board, the create action, and the delete action.

## 7. The board home

### 7.1 Layout

One page, one column, inside the same shell chrome as a board: brand mark on the left,
account menu on the right, no board name, no board tools. The page title is "Your boards"
(DE: "Deine Wände", matching the existing "Wand" vocabulary in the German catalogue).

Below the title:

1. The **continue** card (§7.2), when there is one.
2. **Own boards**, without a group heading: the page title already says "Your boards".
   Each board is one row.
3. **Shared with you**, with that heading. Each board is one row with the role as a
   trailing label, using the existing role labels (EDIT, VIEW).
4. The **New board** action, placed after the own-boards group as a dashed-outline row so it
   reads as "add one here", and repeated as a primary button in the top bar for keyboard
   and screen-reader users who tab through the chrome first.

Within a group, rows are sorted by name, locale-aware, so a renamed board moves where the
user expects. Groups do not interleave: own boards always come first.

### 7.2 Continue card

If the profile remembers a last board (`preferences.lastBoardId`) and that board is in the
list, it is shown once, at the top, as a wider card labelled "Continue" with the board name
and its role. Opening any board updates the remembered board as it does today
([`preferences.ts`](../../apps/web/src/lib/preferences.ts), `useRememberLastBoard`). If the
remembered board is not in the list, there is no continue card and nothing is written.

The card is a hint, not a redirect. It is what makes "always land on the home" cost one
click rather than a search.

### 7.3 A board row

- The whole row is one link to `/boards/:id`, so the click target is large on touch.
- Content: board name (truncated, full name in `title`), role label on the right for shared
  boards, nothing for own boards (the group already says it).
- A trailing overflow menu (`…`, 44 px on touch) with exactly one item: **Delete board** on
  own boards, **Leave board** on shared boards. Rename stays where it is, in the board's own
  top bar, so there is one place to rename.
- Keyboard: rows are in tab order; the overflow menu opens with Enter or Space on its
  button, as the existing menus do.

### 7.4 Empty state

Zero boards: an `EmptyState` with the layout-grid icon, title "No boards yet", hint "Create
one to start placing notes.", and the New board button as its action. The existing
"No board found. Please get in touch with support." copy is removed; zero boards is no longer
an outage.

### 7.5 Small screens

The home is a list and needs no adaptation beyond the existing touch sizes. It is the first
page on which a phone user can reach a shared board at all: the switcher popover is in the
top bar, which on phones has room only for the board name.

### 7.6 Loading and errors

The home uses the same board-list query as the landing and the switcher
([`useBoards.ts`](../../apps/web/src/features/board/hooks/useBoards.ts)). Loading shows the
app skeleton; a failed list shows the existing "could not be loaded" state with retry.
Create, delete and leave report failure through the existing toast and keep the list as it
was.

## 8. Creating a board

- From the home (§7.1) or from the switcher popover (§11): **New board**.
- A small dialog with one field, "Name", prefilled with the localized initial name
  (`INITIAL_BOARD_NAME`, "My Board" / "Meine Wand") so Enter alone works. Same length rule
  as rename (`BOARD_NAME_MAX_LENGTH`).
- On success the app navigates into the new board, which is empty and shows the existing
  "Your board is still empty" state. The board list is refetched so the home and the
  switcher include it.
- The owner limit (§12.4) is checked by the API; when reached, the dialog shows "You have
  reached the limit of 20 boards." and the New board actions are not hidden, because hiding
  them would make the limit undiscoverable.

## 9. Deleting a board

- Owner only. From the home row's overflow menu.
- Confirmation dialog: title "Delete “{name}”?", body "This removes the board, its {count}
  notes and every member's access. This cannot be undone.", destructive button "Delete
  board", cancel. The count comes from the board's note list query, which the owner can
  already read; while it is loading the body says "its notes".
- On confirmation the board disappears from the list immediately. Members lose access on
  their next request (§12.2). If the deleted board was the remembered last board, the
  continue card simply does not render (§7.2).
- If the user deletes the board they are currently in (possible from another tab), the open
  board's next failed read shows the not-found page, whose button leads home. No special
  handling.
- Deleting the first board (id = uid) is allowed and does not cause it to be recreated
  (§12.3).

## 10. Leaving a board

- ACTIVE member with role EDIT or VIEW, on their own membership only. From the home row's
  overflow menu.
- Confirmation dialog: title "Leave “{name}”?", body "You will need a new invitation or
  share link to come back. Notes assigned to you on this board are unassigned.", button
  "Leave board", cancel.
- The server behaviour is the owner's `member.delete` applied to the caller's own
  membership: the member row and the `memberRoles` cache are updated in one transaction, and
  the existing `member.remove` cleanup job unassigns the caller's notes
  ([`maintenance.ts`](../../apps/api/src/lib/commands/maintenance.ts)).
- The owner cannot leave; the row offers Delete instead. Leaving a board one was removed from
  concurrently returns 404, which the UI treats as "already gone": the row disappears and no
  error is shown.

## 11. In-board navigation

- The brand mark in the top bar links to the home (`/boards`), on every board.
- The switcher popover renders for every signed-in user, not only from two boards upwards.
  Its list stays as it is (own boards first, then shared, with role labels). Two items are
  appended below a separator: **All boards** (to `/boards`) and **New board** (opens the
  §8 dialog). With one board the popover is short but it is the only hint, on desktop, that
  more boards are possible.
- The keyboard shortcut help gains no new shortcut. Board switching stays a mouse or
  tab-order action.

## 12. Data model, API and provisioning

### 12.1 Commands

All three go through `executeBoardCommand`
([`commands/index.ts`](../../apps/api/src/lib/commands/index.ts)) with the usual
`Idempotency-Key`, receipts and logging. Added to the command union in
[`command.ts`](../../packages/shared/src/schemas/command.ts) and to the table in
[Board operations](../architecture/board-operations.md):

| Aggregate  | Command        | Route                              | Permission                  | Expected revision | Notes                                                                                                                               |
| ---------- | -------------- | ---------------------------------- | --------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| New board  | `board.create` | `POST /whiteboards`, 201           | Any authenticated user      | None              | Input `{ name }` (rename schema). Returns the board DTO. Rate-limited like invites. `422 BOARD_LIMIT_REACHED` at the limit (§12.4). |
| Board      | `board.delete` | `DELETE /whiteboards/:id`, 204     | OWNER                       | Board             | Tombstones the board and enqueues cleanup (§12.2).                                                                                  |
| Membership | `board.leave`  | `POST /whiteboards/:id/leave`, 204 | ACTIVE member, EDIT or VIEW | None              | Owner gets 403. Same transaction shape as `member.delete`, same `member.remove` cleanup.                                            |

`board.leave` takes no expected revision on purpose: the member is stating a fact about
themselves, not editing the board, and a concurrent rename by the owner must not turn
"leave" into a 409 the member cannot resolve. `board.delete` keeps the board revision so
that a deletion confirmed against a board that changed meanwhile is refused like any other
administration write.

The new board's id is a generated Firestore id, so `preferenceBoardIdSchema`'s character
rule in [`me.ts`](../../packages/shared/src/schemas/me.ts) continues to hold.

### 12.2 Deleting a board

Deletion follows the note pattern in [ADR-0010](../adr/ADR-0010-board-commands-revisions-and-receipts.md):

1. In the command transaction: check OWNER and revision, set `deletedAt` on the board
   document, delete `shareLinks/{token}` if there is one, and write a `boardCleanup` job of a
   new kind `board.delete` with the board id.
2. From that moment `getBoard`, `listBoards`, `requireWhiteboardAccess` and
   `getEffectiveRole` treat a board with `deletedAt` as absent: every member's next request
   on it is a 404, exactly as if they had been removed. The check lives in one whiteboard read
   helper in `collections.ts`, next to the generic `withId`, which every board read uses, so
   no query or preHandler can forget it.
3. The cleanup job, run immediately and resumable by the maintenance command: delete every
   note of the board recursively (subtasks and history go with each note, as note deletion
   does today), then the `members` subcollection, then the board document. A rerun on a
   half-finished job is safe because every step is a delete of something that may already
   be gone.
4. Receipts under `users/{uid}/boardOperations` are untouched and expire as usual. Replay
   of a receipt for a deleted board still rechecks the role, which is now null, so the
   result is not exposed.
5. Per-user `preferences.boards.<id>` entries of members are not touched: they hold only
   view settings, and the existing pruning past `MAX_REMEMBERED_BOARDS` removes them in
   time. `GDPR.md`'s inventory says so.

### 12.3 Provisioning

`provisionUser` creates the first board **only when it creates the user record**. The
`upToDate` check in the auth preHandler drops `boardSnapshot.exists`, and the steady-state
path becomes one document read instead of two. An existing user whose first board was
deleted therefore stays at zero boards and sees the home's empty state, instead of waking up
with a fresh "My Board" they did not ask for.

The first board keeps the uid as its id. Nothing reads meaning into that any more: the
comment in `plugins/auth.ts` that calls it "one whiteboard per owner as a property of the key
space" is rewritten, and `overview.md`'s "Owns one whiteboard" becomes "Owns one or more
whiteboards".

### 12.4 Limits

`MAX_OWN_BOARDS = 20` in [`constants.ts`](../../packages/shared/src/constants.ts).
`board.create` counts the caller's non-deleted owned boards inside its transaction and fails
with `422 BOARD_LIMIT_REACHED` at the limit. The number is a guard against runaway
scripts, not a product tier; twenty boards is already more than the switcher popover shows
comfortably.

### 12.5 Shared contract

- `WhiteboardSummaryDto` is unchanged; the home needs nothing the switcher does not.
- `MeDto.preferences.lastBoardId` is unchanged in shape and meaning ("the board the user
  last opened"); only its consumer moves from the landing to the continue card.
- New error code `BOARD_LIMIT_REACHED` joins the existing envelope.

## 13. Consequences

Pros:

- The cross-account 404 is gone at the root, not patched at the not-found page.
- Shared boards become discoverable on every screen size, including phones, where the
  switcher popover has no room today.
- Users can keep separate contexts (own projects, a team board, a private list) without a
  second account.
- Board deletion is the first real erasure path in the product and takes a concrete step
  towards `GDPR.md`'s GAP-01, which today has no way to delete a board at all.
- Leaving a board removes the one membership action that needed the owner's help.

Cons, and what is done about them:

- "Board id = uid" stops being a universal truth. Mitigated: nothing in the code depends on
  it except provisioning, which is changed; the first board keeps the uid so no data moves.
- One more page to design, translate and test. Mitigated: it reuses the shell, the board
  list query, the empty state, the popover and menu primitives, and the two role labels.
- Sign-in gains one redirect hop through `/` for everyone. Accepted: it was already there
  for the last-board redirect, and it is what makes the return-path check possible.
- Deleting a board is the first destructive operation on a whole aggregate. Mitigated: a
  confirmation that names the board and the note count, a tombstone that hides it at once,
  and a resumable cleanup that cannot strand content.
- Users with one board now see a switcher popover they did not have before. Accepted: it
  is the only discoverable path to "New board" on desktop short of visiting the home.
- `board.create` has no per-route rate limit (a deviation from §12.1). A script can create and
  delete boards up to the global limit of 300 requests a minute, each deletion enqueuing a
  cleanup job. Accepted: `MAX_OWN_BOARDS` caps what exists at any time, cleanup is idempotent,
  and a per-route bucket can be added if abuse shows up.

## 14. Non-goals

Each is out because it is a different feature with its own questions, not because it is
hard:

- **Archiving instead of deleting.** Needs a third list, restore semantics and retention
  rules. Delete with a clear confirmation is honest and sufficient.
- **Transferring ownership.** Changes who may delete, share and invite; a permission design
  of its own.
- **Moving or copying notes between boards.** `note.duplicate` is board-local by design;
  cross-board copies need a rule for assignees, members and properties that do not exist
  on the target.
- **Board templates or duplicating a board.** No request behind it.
- **Manual ordering, pinning or favourites on the home.** Two groups sorted by name plus a
  continue card cover the sizes this product is built for.
- **Board-level notifications or activity.** Out of scope in `SPEC.md` §14 already.

## 15. What changes where

| Area                | Change                                                                                                                                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/shared`   | `board.create`, `board.delete`, `board.leave` in the command union; `MAX_OWN_BOARDS`; `BOARD_LIMIT_REACHED`.                                                                                                                                                                                                 |
| `apps/api`          | Three commands in `lib/commands`; routes; `board.delete` cleanup kind in `maintenance.ts`; `deletedAt` handling in `authorization.ts` and `queries.ts`; provisioning change in `plugins/auth.ts`; tests for each, including replay on a deleted board.                                                       |
| `apps/web`          | `/boards` home route and page; `/` landing resolves the return path and the §6 rule; sign-out clears the return path; sign-in navigates to `/`; switcher renders always, with All boards and New board; create, delete, leave dialogs; not-found button copy; `en.ts` and `de.ts` keys for all of the above. |
| `apps/web/e2e`      | `auth.spec.ts` asserts the single-board landing and adds the sign-out, sign-in-as-other-user case; a new `boards.spec.ts` covers create, land on home, delete, leave. The `share.spec.ts` flow is unchanged.                                                                                                 |
| `docs/SPEC.md`      | §4a: "Opening the app returns to the board the user last had open" becomes the §6 rule; §14 drops "Multiple whiteboards per user"; §9 gains leave. New section for the home, create and delete.                                                                                                              |
| `docs/architecture` | `overview.md` person description and data-model row for `whiteboards/{id}` (ids are no longer always the uid; `deletedAt`); `board-operations.md` table gains the three commands and the `board.delete` cleanup kind.                                                                                        |
| `docs/GDPR.md`      | Board deletion added to the inventory; GAP-01 narrowed to account erasure.                                                                                                                                                                                                                                   |
| `docs/README.md`    | This file listed under proposals; removed from there once it moves into `SPEC.md`.                                                                                                                                                                                                                           |

## 16. Acceptance criteria

1. User A opens their board, signs out. User B signs in on the same login page. B lands on
   B's own landing result (§6), never on A's board and never on a 404.
2. A signed-out visitor opens `/boards/:id` of a board they are a member of, signs in, and
   lands on that board. The same visitor opening a board they are not a member of lands on
   `/` resolved per §6, with no 404.
3. A signed-out visitor opens a share link, signs in, and is added to the board, as today.
4. A new sign-up lands in their first board. After they create a second board, the next
   sign-in lands on the home with both boards listed and a continue card for the one last
   opened.
5. A user with zero boards sees the empty state and can create a board from it.
6. Creating a board navigates into it; it appears in the home and in the switcher without a
   reload. The twenty-first creation is refused with the limit message.
7. Deleting a board removes it from the owner's lists at once; a member's open tab shows the
   not-found page on its next read; after cleanup no note, subtask, history event, member
   row, share link or board document remains.
8. Leaving a board removes it from the member's lists at once; their assignments on it are
   cleared by cleanup; the owner's member list no longer shows them.
9. The owner's row offers Delete and never Leave; a member's row offers Leave and never
   Delete. The API refuses the other way round.
10. Every new string exists in both catalogues, and the home, dialogs and menus are operable
    by keyboard and announced by a screen reader as the existing menus are.
11. The auth preHandler's steady-state path performs one Firestore read, not two.
