# Board Home and Multiple Boards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the cross-account 404 after sign-out, and give every user a board home with create, delete and leave, so a user can hold several own boards next to the ones they were invited to.

**Architecture:** Three new commands (`board.create`, `board.delete`, `board.leave`) join the existing command layer in `apps/api/src/lib/commands`, with a board tombstone (`deletedAt`) that one read helper hides from every query. The web app gets a landing resolver at `/` that validates the return path against the caller's board list, a home page at `/boards`, and three small mutations that bypass the draft-recovery queue because they carry no draft. Provisioning stops recreating a missing first board.

**Tech Stack:** TypeScript, Fastify + firebase-admin Firestore (API), React 19 + react-router 8 + TanStack Query + Radix (web), Zod contract in `packages/shared`, Vitest, Playwright, Docker Compose with the Firestore emulator.

**Spec:** `docs/rfcs/0002-board-home.md` (approved 2026-10-14). Section numbers below (§5, §12.2 …) refer to it.

## Context

User A signs out while on their board; the protected route stores that board path as the login page's return location; User B signs in on the same login page and is sent to A's board, which the API hides as 404. The RFC traces the bug to two things: a return path that survives a sign-out, and a return path trusted without checking the new caller's board list. Fixing it properly needs a landing page that knows the board list, and once that exists the product owner wants the rest: a home for all boards, more than one own board, delete, and leave. The plan implements the RFC in full and amends the docs it names.

## Global Constraints

- Every write goes through `executeBoardCommand` with `Idempotency-Key` and a receipt; never write Firestore from a route (board-operations.md).
- `board.create` and `board.leave` take **no** expected revision; `board.delete` takes the **board** revision (§12.1).
- Limit: `MAX_OWN_BOARDS = 20`; error `422 BOARD_LIMIT_REACHED` (§12.4).
- A board with `deletedAt` reads as absent everywhere, exactly like a non-member's 404 (§12.2).
- First board keeps `id === uid`; created only when the user record is created (§12.3). Steady-state auth path is one Firestore read (§16.11).
- Routes: `/` landing, `/boards` home, `/boards/:boardId` unchanged (§4, §6).
- Copy: German `de.ts` is the key authority, `en.ts` must mirror its keys (`resources.test.ts`); no literal copy in components (`noHardcodedCopy.test.ts`). The RFC's German vocabulary is "Wand" / "Wände".
- Button rules in `components/ui/button-variants.ts`: `accent` at most once per screen; `destructive` only on the confirm step, `destructive-ghost` as its entry point.
- Branch `feat/board-home`; Conventional Commits; small commits; never commit to `main`. Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Tests run in Docker: `make test` (all), or one package / file with `docker compose run --rm api pnpm --filter @wally/api test -- <file>` and `docker compose run --rm api pnpm --filter @wally/web test -- <file>`. Never `make down` without exporting the emulator (it holds real data; see memory). Run API test files one at a time while developing; `make test` runs them in parallel by project id.
- Definition of done (SETUP.md): `make test`, `make lint`, `make typecheck`, `pnpm format:check` pass; no console errors; verified in the running app.

## Review Focus

1. A return path that is not an in-app path (`https://evil.example`, `//evil.example`, `javascript:`) must be ignored, never navigated to. Test in Task 8.
2. A board deleted from another tab while open: the open tab's next read 404s and shows the not-found page whose button goes to `/`, never a blank screen. Test in Task 11.
3. A whitespace-only board name in the create dialog must not reach the API; Enter with the prefilled name must create. Test in Task 10.
4. The remembered last board no longer in the list (deleted or left): no continue card, nothing written, landing still resolves. Tests in Tasks 8 and 10.
5. A retry of delete or leave after the first request succeeded returns 404; the client treats it as "already gone", clears the unsaved-changes entry and shows no error. Test in Task 9.

---

## File map

| Area   | File                                                                                                                                                 | Responsibility                                                                       |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| shared | `packages/shared/src/schemas/command.ts`                                                                                                             | three new union members                                                              |
| shared | `packages/shared/src/schemas/board.ts`                                                                                                               | `whiteboardCreateSchema`                                                             |
| shared | `packages/shared/src/constants.ts`                                                                                                                   | `MAX_OWN_BOARDS`                                                                     |
| api    | `src/lib/db/types.ts`                                                                                                                                | `WhiteboardDoc.deletedAt?`                                                           |
| api    | `src/lib/db/collections.ts`                                                                                                                          | `liveWhiteboard()` read helper                                                       |
| api    | `src/lib/commands/queries.ts`, `index.ts`, `administration.ts`, `maintenance.ts`, `members.ts`, `authorization.ts`                                   | tombstone awareness, three commands, cleanup kind                                    |
| api    | `src/routes/boards.ts`                                                                                                                               | three routes                                                                         |
| api    | `src/plugins/auth.ts`                                                                                                                                | provisioning change                                                                  |
| api    | `test/boards-lifecycle.test.ts` (new), `test/helpers.ts`, `test/me.test.ts`, `test/whiteboards.test.ts`, `src/lib/authorization.test.ts`             | tests                                                                                |
| web    | `features/auth/AuthProvider.tsx`, `ProtectedRoute.tsx`, `SignInForm.tsx`, `SignUpForm.tsx`, `returnPath.ts` (new)                                    | sign-out clears the return path; sign-in hands it to the landing                     |
| web    | `routes/LoginPage.tsx`, `SignupPage.tsx`, `LandingPage.tsx` (renamed from `RootRedirect.tsx`), `BoardsPage.tsx` (new), `NotFoundPage.tsx`, `App.tsx` | routes                                                                               |
| web    | `lib/apiClient.ts`, `lib/resources.ts`                                                                                                               | create bypasses the queue; delete/leave 404 as gone; `boardsApi.create/remove/leave` |
| web    | `features/board/hooks/mutations/useCreateBoard.ts`, `useDeleteBoard.ts`, `useLeaveBoard.ts` (new)                                                    | mutations                                                                            |
| web    | `features/boards/BoardHome.tsx`, `BoardRow.tsx`, `HomeShell.tsx`, `NewBoardDialog.tsx`, `DeleteBoardDialog.tsx`, `LeaveBoardDialog.tsx` (new)        | home page                                                                            |
| web    | `features/board/TopBar.tsx`, `BoardSwitcher.tsx`, `AccountMenu.tsx`                                                                                  | in-board navigation                                                                  |
| web    | `i18n/de.ts`, `i18n/en.ts`                                                                                                                           | copy                                                                                 |
| web    | `e2e/support.ts`, `e2e/boards.spec.ts` (new), `e2e/README.md`, `.github/workflows/ci.yml`                                                            | E2E                                                                                  |
| docs   | `SPEC.md`, `architecture/overview.md`, `architecture/board-operations.md`, `GDPR.md`, `README.md`, `rfcs/0002-board-home.md`, `adr/0011-…` (new)     | documentation                                                                        |

Note on plan location: this file lives in the plan directory the host chose. Task 0 copies it into the repo at `docs/superpowers/plans/2026-10-14-board-home.md` so it travels with the branch.

---

### Task 0: Branch and plan copy

**Files:**

- Create: `docs/superpowers/plans/2026-10-14-board-home.md`

- [ ] **Step 1: Create the worktree branch** (the main checkout is bind-mounted into Docker; never switch branches there, see memory `project_wally_live_checkout`)

Run: `git worktree add ../wally-board-home -b feat/board-home main` and work in `../wally-board-home`. Docker commands below assume the compose stack of the worktree; if the stack must stay on the main checkout, run tests from the main checkout only after merging, and use `pnpm --filter @wally/api test` with `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_PROJECT_ID=wally-ci` against the running emulator (port 8080 is published by `docker-compose.yml`).

- [ ] **Step 2: Copy this plan into the repo and commit**

```bash
mkdir -p docs/superpowers/plans
cp /Users/mr_user/.claude/plans/approved-write-the-implementation-purring-flamingo.md docs/superpowers/plans/2026-10-14-board-home.md
git add docs/superpowers/plans/2026-10-14-board-home.md
git commit -m "docs: add the board home implementation plan"
```

---

### Task 1: Shared contract

**Files:**

- Modify: `packages/shared/src/schemas/command.ts` (union, after `board.rename` at line ~59)
- Modify: `packages/shared/src/schemas/board.ts`
- Modify: `packages/shared/src/constants.ts`

**Interfaces:**

- Produces: `BoardCommand` members `{ type: 'board.create', input: { name } }`, `{ type: 'board.delete', boardId, input: {} }`, `{ type: 'board.leave', boardId, input: {} }`; `whiteboardCreateSchema`; `MAX_OWN_BOARDS = 20`.

- [ ] **Step 1: Add the schema and constant**

`board.ts`, after `whiteboardRenameSchema`:

```ts
/** Same rule as rename: one trimmed, non-empty name. Kept separate so the two can diverge. */
export const whiteboardCreateSchema = whiteboardRenameSchema;
export type WhiteboardCreateInput = z.infer<typeof whiteboardCreateSchema>;
```

`constants.ts`, next to `MAX_REMEMBERED_BOARDS`:

```ts
/** Boards one user may own. A guard against runaway scripts, not a product tier. */
export const MAX_OWN_BOARDS = 20;
```

`command.ts`, inside the discriminated union after the `board.rename` member:

```ts
  z.object({ type: z.literal('board.create'), input: whiteboardCreateSchema.strict() }).strict(),
  z.object({ type: z.literal('board.delete'), ...board, input: empty }).strict(),
  z.object({ type: z.literal('board.leave'), ...board, input: empty }).strict(),
```

Import `whiteboardCreateSchema` from `./board.js`. Also update the doc comment on `INITIAL_BOARD_NAME` in `constants.ts` to "the name of the board provisioned with a new user record, and the prefilled name in the New board dialog".

- [ ] **Step 2: Typecheck**

Run: `docker compose run --rm api pnpm turbo run typecheck --filter=@wally/shared`
Expected: no errors. (The API typecheck will now fail until Task 3 to 5 handle the new types in `executeAdminCommand`'s `if` chain; that is expected and is fixed there.)

- [ ] **Step 3: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): board.create, board.delete and board.leave commands"
```

---

### Task 2: API: board tombstone read helper

**Files:**

- Modify: `apps/api/src/lib/db/types.ts` (`WhiteboardDoc`)
- Modify: `apps/api/src/lib/db/collections.ts` (next to `withId`)
- Modify: `apps/api/src/lib/commands/queries.ts` (`getBoard`, `listBoards`, `boardSnapshot`)
- Modify: `apps/api/src/lib/commands/index.ts` (receipt path line ~92, board load line ~114)
- Modify: `apps/api/src/lib/commands/maintenance.ts` (`member.remove` transaction, `reconcileBoards` loops)
- Modify: `apps/api/src/lib/members.ts` (`activatePendingInvitesForEmail`, the `const board = withId(...)` read)
- Modify: `apps/api/src/lib/authorization.ts` (`getEffectiveRole`, `requireWhiteboardAccess`)
- Test: `apps/api/test/whiteboards.test.ts`, `apps/api/src/lib/authorization.test.ts`

**Interfaces:**

- Produces: `liveWhiteboard(snapshot: DocumentSnapshot<WhiteboardDoc>): WithId<WhiteboardDoc> | null` — `withId` plus `null` when `deletedAt` is set. `WhiteboardDoc.deletedAt?: Timestamp`.

- [ ] **Step 1: Write the failing tests**

In `apps/api/test/whiteboards.test.ts` (uses `createBoardFixture`; follow its existing `beforeAll/beforeEach` setup) add:

```ts
describe('a tombstoned board', () => {
  beforeEach(async () => {
    await whiteboardsCol(ctx.db).doc(fx.boardId).update({ deletedAt: Timestamp.now() });
  });

  it('is absent from the owner’s and a member’s board list', async () => {
    for (const token of [fx.ownerToken, fx.editToken]) {
      const res = await ctx.inject({
        method: 'GET',
        url: '/whiteboards',
        headers: ctx.authHeader(token),
      });
      expect(res.json()).toEqual([]);
    }
  });

  it('reads as 404 for the owner, exactly like a board that never existed', async () => {
    const get = await ctx.inject({
      method: 'GET',
      url: `/whiteboards/${fx.boardId}`,
      headers: ctx.authHeader(fx.ownerToken),
    });
    expect(get.statusCode).toBe(404);
    const rename = await ctx.inject({
      method: 'PATCH',
      url: `/whiteboards/${fx.boardId}`,
      headers: ctx.authHeader(fx.ownerToken),
      payload: { name: 'Nope' },
    });
    expect(rename.statusCode).toBe(404);
    const note = await ctx.inject({
      method: 'POST',
      url: `/whiteboards/${fx.boardId}/notes`,
      headers: ctx.authHeader(fx.ownerToken),
      payload: { title: 'Nope' },
    });
    expect(note.statusCode).toBe(404);
  });
});
```

Import `Timestamp` from `firebase-admin/firestore` and `whiteboardsCol` from `../src/lib/db/collections.js` if not already imported.

In `apps/api/src/lib/authorization.test.ts` add:

```ts
it('returns null for a tombstoned whiteboard, even for its owner', async () => {
  await whiteboardsCol(db).doc(board).update({ deletedAt: Timestamp.now() });
  await expect(getEffectiveRole(db, 'u-owner', board)).resolves.toBeNull();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `docker compose run --rm api pnpm --filter @wally/api test -- test/whiteboards.test.ts src/lib/authorization.test.ts`
Expected: the new tests FAIL (list still contains the board, GET returns 200, role is OWNER).

- [ ] **Step 3: Implement**

`types.ts`, in `WhiteboardDoc` after `revision?`:

```ts
  /**
   * Set by board.delete. From that moment the board reads as absent for everyone — read it
   * through liveWhiteboard(), never withId(), except in the cleanup job that finishes it.
   */
  deletedAt?: Timestamp;
```

`collections.ts`, after `withId`:

```ts
/** A whiteboard read that treats a tombstoned board as missing. Every board read in a query
 * or command goes through this; only the board.delete cleanup job may see the tombstone. */
export function liveWhiteboard(
  snapshot: DocumentSnapshot<WhiteboardDoc>,
): WithId<WhiteboardDoc> | null {
  const board = withId(snapshot);
  return board && !board.deletedAt ? board : null;
}
```

Replace `withId(await tx.get(whiteboardsCol(db).doc(...)))` with `liveWhiteboard(...)` in: `queries.ts` `getBoard` and `boardSnapshot`; `index.ts` lines ~92 and ~114; `maintenance.ts` inside the `member.remove` per-note transaction; `members.ts` in `activatePendingInvitesForEmail`; `authorization.ts` `getEffectiveRole` and the board read in `requireWhiteboardAccess`. In `listBoards` filter `owned` with `.filter((b) => !b.deletedAt)` and replace the per-id `withId` read with `liveWhiteboard`. In `reconcileBoards` skip documents whose data has `deletedAt` (both loops: the role-cache loop skips them; the orphan-link loop treats a tombstoned board as absent so its link is an orphan).

- [ ] **Step 4: Run tests**

Run: the same command as Step 2, then `docker compose run --rm api pnpm --filter @wally/api test` for the whole package.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): a tombstoned whiteboard reads as absent everywhere"
```

---

### Task 3: API: board.create

**Files:**

- Modify: `apps/api/src/lib/commands/index.ts` (new branch before the note/board resolution, lines ~100–110)
- Modify: `apps/api/src/lib/commands/administration.ts` (new exported `createBoard`)
- Modify: `apps/api/src/routes/boards.ts` (command table + target selection in the loop)
- Modify: `apps/api/test/helpers.ts` (`ctx.inject` revision lookup)
- Test: `apps/api/test/boards-lifecycle.test.ts` (new)

**Interfaces:**

- Produces: `POST /whiteboards` → 201 `WhiteboardDto` with `currentUserRole: 'OWNER'`, `revision: 1`; header `X-Resource-Revision: 1`; `422 BOARD_LIMIT_REACHED`.
- Produces: `createBoard(db, tx, actor, name, timestamp): Promise<CommandResult>` in `administration.ts`.

- [ ] **Step 1: Fix the test helper so a URL without a board id works**

In `test/helpers.ts` `ctx.inject`, guard the lookup: `else if (parts[1] === 'whiteboards' && parts[2])`. Without this, `doc(undefined)` throws for `POST /whiteboards`.

- [ ] **Step 2: Write the failing tests**

Create `apps/api/test/boards-lifecycle.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MAX_OWN_BOARDS } from '@wally/shared';
import { buildTestApp, createBoardFixture, resetDatabase, type TestContext } from './helpers.js';

const projectId = 'wally-boards-lifecycle';
let ctx: TestContext;
let fx: Awaited<ReturnType<typeof createBoardFixture>>;

beforeAll(async () => {
  ctx = await buildTestApp(projectId);
});
beforeEach(async () => {
  await resetDatabase(projectId);
  fx = await createBoardFixture(ctx);
});
afterAll(async () => {
  await ctx.app.close();
});

const create = (token: string, name = 'Projekt Nord', key = randomUUID()) =>
  ctx.app.inject({
    method: 'POST',
    url: '/whiteboards',
    headers: { ...ctx.authHeader(token), 'idempotency-key': key },
    payload: { name },
  });

describe('board.create', () => {
  it('creates a second own board with a generated id and lists it as OWNER', async () => {
    const res = await create(fx.ownerToken);
    expect(res.statusCode).toBe(201);
    const dto = res.json();
    expect(dto).toMatchObject({
      name: 'Projekt Nord',
      ownerId: fx.ownerId,
      currentUserRole: 'OWNER',
      revision: 1,
    });
    expect(dto.id).not.toBe(fx.ownerId);
    expect(res.headers['x-resource-revision']).toBe('1');
    const list = await ctx.inject({
      method: 'GET',
      url: '/whiteboards',
      headers: ctx.authHeader(fx.ownerToken),
    });
    expect(list.json()).toEqual(
      expect.arrayContaining([{ id: dto.id, name: 'Projekt Nord', currentUserRole: 'OWNER' }]),
    );
  });

  it('replays the same operation id instead of creating twice', async () => {
    const key = randomUUID();
    const first = await create(fx.ownerToken, 'Einmal', key);
    const second = await create(fx.ownerToken, 'Einmal', key);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect((await create(fx.ownerToken, 'Anders', key)).statusCode).toBe(409);
    const list = await ctx.inject({
      method: 'GET',
      url: '/whiteboards',
      headers: ctx.authHeader(fx.ownerToken),
    });
    expect(list.json().filter((b: { name: string }) => b.name === 'Einmal')).toHaveLength(1);
  });

  it('refuses a blank name and a missing operation id', async () => {
    expect((await create(fx.ownerToken, '   ')).statusCode).toBe(400);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/whiteboards',
      headers: ctx.authHeader(fx.ownerToken),
      payload: { name: 'x' },
    });
    expect(res.statusCode).toBe(428);
  });

  it('stops at MAX_OWN_BOARDS live boards, not counting deleted ones', async () => {
    // The fixture owner already owns one board.
    for (let i = 1; i < MAX_OWN_BOARDS; i++)
      expect((await create(fx.ownerToken, `Wand ${i}`)).statusCode).toBe(201);
    const over = await create(fx.ownerToken, 'Eine zu viel');
    expect(over.statusCode).toBe(422);
    expect(over.json().error).toBe('BOARD_LIMIT_REACHED');
  });
});
```

(The "not counting deleted ones" half is completed in Task 4, which adds a delete before the final create.) `board.create` gets **no** per-route rate limit: the own-board cap already bounds it, and a 20-per-minute bucket shared by every test in this file would 429 the limit tests. The global 300-per-minute limit still applies. This deviates from RFC §12.1 ("rate-limited like invites"); Task 13 records it in board-operations.md.

- [ ] **Step 3: Run to verify they fail**

Run: `docker compose run --rm api pnpm --filter @wally/api test -- test/boards-lifecycle.test.ts`
Expected: FAIL with 404 (route missing).

- [ ] **Step 4: Implement `createBoard`**

`administration.ts`:

```ts
export async function createBoard(
  db: Firestore,
  tx: Transaction,
  actor: Actor,
  name: string,
  operationBoardRef = whiteboardsCol(db).doc(),
): Promise<CommandResult> {
  const owned = docsWithId(await tx.get(whiteboardsCol(db).where('ownerId', '==', actor.id)));
  if (owned.filter((b) => !b.deletedAt).length >= MAX_OWN_BOARDS)
    throw new AppError(422, 'BOARD_LIMIT_REACHED', `You can own at most ${MAX_OWN_BOARDS} boards`);
  const timestamp = now();
  const doc: WhiteboardDoc = {
    name,
    ownerId: actor.id,
    revision: 1,
    memberRoles: {},
    shareLinkToken: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  tx.create(operationBoardRef, doc);
  return {
    data: toWhiteboardDto({ ...doc, id: operationBoardRef.id }, 'OWNER'),
    revision: 1,
    status: 201,
    boardId: operationBoardRef.id,
  };
}
```

Imports: `MAX_OWN_BOARDS` from `@wally/shared`, `Firestore, Transaction` types, `Actor`, `AppError`, `docsWithId`, `now`, `whiteboardsCol`, `toWhiteboardDto`.

`index.ts`: inside `runCommandTransaction`, right after the receipt block and before `const note = ...`:

```ts
if (command.type === 'board.create') {
  const result = await createBoard(db, tx, actor, command.input.name);
  tx.create(receiptRef, {
    fingerprint,
    boardId: result.boardId,
    result,
    createdAt: Timestamp.now(),
    expiresAt: Timestamp.fromMillis(Date.now() + 7 * 86400000),
  });
  return { result, replayed: false };
}
```

Extract the receipt write into a local `writeReceipt(boardId, result)` used by both places so the two stay identical. The receipt replay path already re-authorizes against `receipt.boardId`, which for a create is the new board, where the actor is OWNER.

`rolesFor` needs no change (never reached for create).

`routes/boards.ts`: add to the command table `{ method: 'POST', url: '/whiteboards', type: 'board.create', response: whiteboardDtoSchema, status: 201 }` (no `limit`, see Step 2). In the handler's `target` selection add a first case: `route.type === 'board.create' ? {} : …`.

- [ ] **Step 5: Run tests**

Run: Step 3's command. Expected: PASS (the limit test passes without the deletion half).

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): board.create with a per-owner limit"
```

---

### Task 4: API: board.delete and its cleanup job

**Files:**

- Modify: `apps/api/src/lib/commands/administration.ts` (new branch after `board.rename`)
- Modify: `apps/api/src/lib/commands/maintenance.ts` (`drainCleanupJob` new kind)
- Modify: `apps/api/src/routes/boards.ts` (route)
- Test: `apps/api/test/boards-lifecycle.test.ts`

**Interfaces:**

- Produces: `DELETE /whiteboards/:id` → 204, OWNER only, expected revision = board. Cleanup job `{ kind: 'board.delete', boardId, createdAt }`.

- [ ] **Step 1: Write the failing tests**

Append to `boards-lifecycle.test.ts`:

```ts
import { drainCleanup } from '../src/lib/commands/maintenance.js';
import { membersCol, notesCol, shareLinksCol, whiteboardsCol } from '../src/lib/db/collections.js';

const del = (token: string, boardId: string, key = randomUUID()) =>
  ctx.inject({
    method: 'DELETE',
    url: `/whiteboards/${boardId}`,
    headers: { ...ctx.authHeader(token), 'idempotency-key': key },
  });

describe('board.delete', () => {
  it('is for the owner only', async () => {
    expect((await del(fx.editToken, fx.boardId)).statusCode).toBe(403);
    expect((await del(fx.outsiderToken, fx.boardId)).statusCode).toBe(404);
  });

  it('hides the board at once and finishes the physical deletion in cleanup', async () => {
    const note = (
      await ctx.inject({
        method: 'POST',
        url: `/whiteboards/${fx.boardId}/notes`,
        headers: ctx.authHeader(fx.ownerToken),
        payload: { title: 'Weg damit' },
      })
    ).json();
    await ctx.inject({
      method: 'POST',
      url: `/notes/${note.id}/subtasks`,
      headers: ctx.authHeader(fx.ownerToken),
      payload: { text: 'Teil' },
    });
    await ctx.inject({
      method: 'POST',
      url: `/whiteboards/${fx.boardId}/share-link`,
      headers: ctx.authHeader(fx.ownerToken),
      payload: { role: 'VIEW' },
    });
    const token = (await whiteboardsCol(ctx.db).doc(fx.boardId).get()).data()!.shareLinkToken!;

    expect((await del(fx.ownerToken, fx.boardId)).statusCode).toBe(204);

    for (const t of [fx.ownerToken, fx.editToken]) {
      expect(
        (
          await ctx.inject({ method: 'GET', url: '/whiteboards', headers: ctx.authHeader(t) })
        ).json(),
      ).toEqual([]);
      expect(
        (
          await ctx.inject({
            method: 'GET',
            url: `/whiteboards/${fx.boardId}`,
            headers: ctx.authHeader(t),
          })
        ).statusCode,
      ).toBe(404);
    }
    expect((await shareLinksCol(ctx.db).doc(token).get()).exists).toBe(false);

    expect(await drainCleanup(ctx.db)).toEqual({ completed: 0, pending: 0 }); // already drained inline
    expect((await notesCol(ctx.db).doc(note.id).get()).exists).toBe(false);
    expect((await notesCol(ctx.db).doc(note.id).collection('subtasks').get()).size).toBe(0);
    expect((await membersCol(ctx.db, fx.boardId).get()).size).toBe(0);
    expect((await whiteboardsCol(ctx.db).doc(fx.boardId).get()).exists).toBe(false);
  });

  it('keeps the job and the tombstone when cleanup fails, and a later drain finishes it', async () => {
    vi.spyOn(ctx.db, 'recursiveDelete').mockRejectedValueOnce(new Error('interrupted'));
    expect((await del(fx.ownerToken, fx.boardId)).statusCode).toBe(204);
    expect((await ctx.db.collection('boardCleanup').get()).size).toBe(1);
    expect((await whiteboardsCol(ctx.db).doc(fx.boardId).get()).data()?.deletedAt).toBeTruthy();
    expect(await drainCleanup(ctx.db)).toEqual({ completed: 1, pending: 0 });
    expect((await whiteboardsCol(ctx.db).doc(fx.boardId).get()).exists).toBe(false);
  });

  it('refuses a stale revision and answers a retry after completion with 404', async () => {
    const key = randomUUID();
    await ctx.inject({
      method: 'PATCH',
      url: `/whiteboards/${fx.boardId}`,
      headers: ctx.authHeader(fx.ownerToken),
      payload: { name: 'Umbenannt' },
    });
    const stale = await ctx.app.inject({
      method: 'DELETE',
      url: `/whiteboards/${fx.boardId}`,
      headers: {
        ...ctx.authHeader(fx.ownerToken),
        'idempotency-key': key,
        'x-expected-revision': '0',
      },
    });
    expect(stale.statusCode).toBe(409);
    expect((await del(fx.ownerToken, fx.boardId, key)).statusCode).toBe(204);
    // The receipt exists, but re-authorization against a board that now reads as absent fails.
    expect((await del(fx.ownerToken, fx.boardId, key)).statusCode).toBe(404);
  });

  it('frees a slot under MAX_OWN_BOARDS', async () => {
    for (let i = 1; i < MAX_OWN_BOARDS; i++)
      expect((await create(fx.ownerToken, `Wand ${i}`)).statusCode).toBe(201);
    expect((await create(fx.ownerToken, 'Zu viel')).statusCode).toBe(422);
    expect((await del(fx.ownerToken, fx.boardId)).statusCode).toBe(204);
    expect((await create(fx.ownerToken, 'Passt wieder')).statusCode).toBe(201);
  });
});
```

Import `vi` and add `afterEach(() => vi.restoreAllMocks())`. The 409 check uses `ctx.app.inject` directly because `ctx.inject` auto-fills the live revision.

- [ ] **Step 2: Run to verify they fail**

Run: `docker compose run --rm api pnpm --filter @wally/api test -- test/boards-lifecycle.test.ts`
Expected: FAIL (404 route missing).

- [ ] **Step 3: Implement**

`administration.ts`, after the `board.rename` branch:

```ts
if (command.type === 'board.delete') {
  const cleanupId = `${actor.id}_${ctx.operationId}`;
  if (board.shareLinkToken) tx.delete(shareLinksCol(db).doc(board.shareLinkToken));
  updateBoard({ deletedAt: timestamp, shareLinkToken: null });
  tx.create(db.collection('boardCleanup').doc(cleanupId), {
    kind: 'board.delete',
    boardId: board.id,
    createdAt: timestamp,
  });
  return result(null, 204, revision, cleanupId);
}
```

`maintenance.ts`, new branch in `drainCleanupJob`:

```ts
  } else if (job.kind === 'board.delete') {
    const boardRef = whiteboardsCol(db).doc(job.boardId);
    const board = (await boardRef.get()).data();
    if (board && !board.deletedAt) throw new Error('Invalid board deletion cleanup target');
    const notes = await notesCol(db).where('whiteboardId', '==', job.boardId).get();
    for (const row of notes.docs) await db.recursiveDelete(row.ref);
    // Takes the members subcollection with the board document.
    await db.recursiveDelete(boardRef);
  }
```

Every step is a delete of something that may already be gone, so a rerun is safe. `routes/boards.ts`: `{ method: 'DELETE', url: '/whiteboards/:id', type: 'board.delete', status: 204 }`.

- [ ] **Step 4: Run tests, then the whole API package**

Expected: PASS. `board-safety.test.ts` and `membership-integrity.test.ts` still pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): board.delete tombstones the board and cleans it up durably"
```

---

### Task 5: API: board.leave

**Files:**

- Modify: `apps/api/src/lib/commands/index.ts` (`rolesFor`, revision-check exclusion)
- Modify: `apps/api/src/lib/commands/administration.ts` (member branch)
- Modify: `apps/api/src/routes/boards.ts`
- Test: `apps/api/test/boards-lifecycle.test.ts`

**Interfaces:**

- Produces: `POST /whiteboards/:id/leave` → 204 for an ACTIVE EDIT/VIEW member, 403 for the owner, 404 for a non-member; no expected revision; reuses the `member.remove` cleanup.

- [ ] **Step 1: Write the failing tests**

```ts
const leave = (token: string, boardId: string, key = randomUUID()) =>
  ctx.app.inject({
    method: 'POST',
    url: `/whiteboards/${boardId}/leave`,
    headers: { ...ctx.authHeader(token), 'idempotency-key': key },
    payload: {},
  });

describe('board.leave', () => {
  it('lets a member leave without an expected revision, and clears their assignments', async () => {
    const note = (
      await ctx.inject({
        method: 'POST',
        url: `/whiteboards/${fx.boardId}/notes`,
        headers: ctx.authHeader(fx.ownerToken),
        payload: { title: 'Für Editor' },
      })
    ).json();
    await ctx.inject({
      method: 'POST',
      url: `/notes/${note.id}/assign`,
      headers: ctx.authHeader(fx.ownerToken),
      payload: { assigneeId: fx.editorId },
    });

    expect((await leave(fx.editToken, fx.boardId)).statusCode).toBe(204);

    expect(
      (
        await ctx.inject({
          method: 'GET',
          url: '/whiteboards',
          headers: ctx.authHeader(fx.editToken),
        })
      ).json(),
    ).toEqual([]);
    expect(
      (
        await ctx.inject({
          method: 'GET',
          url: `/whiteboards/${fx.boardId}`,
          headers: ctx.authHeader(fx.editToken),
        })
      ).statusCode,
    ).toBe(404);
    const members = (
      await ctx.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}/members`,
        headers: ctx.authHeader(fx.ownerToken),
      })
    ).json();
    expect(members.some((m: { userId: string | null }) => m.userId === fx.editorId)).toBe(false);
    expect((await notesCol(ctx.db).doc(note.id).get()).data()?.assigneeId).toBeNull();
    expect(
      (await whiteboardsCol(ctx.db).doc(fx.boardId).get()).data()?.memberRoles[fx.editorId],
    ).toBeUndefined();
  });

  it('is refused for the owner and unknown for an outsider', async () => {
    expect((await leave(fx.ownerToken, fx.boardId)).statusCode).toBe(403);
    expect((await leave(fx.outsiderToken, fx.boardId)).statusCode).toBe(404);
  });

  it('answers a retry after leaving with 404', async () => {
    const key = randomUUID();
    expect((await leave(fx.viewToken, fx.boardId, key)).statusCode).toBe(204);
    expect((await leave(fx.viewToken, fx.boardId, key)).statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Expected: FAIL (404 route missing).

- [ ] **Step 3: Implement**

`index.ts` `rolesFor`: add `if (command.type === 'board.leave') return ['EDIT', 'VIEW'];` before the default. In the revision check condition add `&& command.type !== 'board.leave'`.

`administration.ts`, in the member branch's `if/else` chain (the branch that reads `rows`), add before the `link.redeem` `else`:

```ts
    } else if (command.type === 'board.leave') {
      const own = rows.filter((row) => row.userId === actor.id && row.status === 'ACTIVE');
      if (own.length === 0) notFound();
      nextRows = rows.filter((row) => !own.includes(row));
      for (const row of own) tx.delete(members.doc(row.id));
      deletedUser = actor.id;
```

The branch condition at the top of the member block must include `'board.leave'`. The existing tail (`rolesFromMembers`, `updateBoard({ memberRoles })`, the `member.remove` job when `deletedUser` has no role left) already does the rest; add `if (command.type === 'board.leave') return result(null, 204, revision, cleanupId);` next to the `member.delete` return.

`routes/boards.ts`: `{ method: 'POST', url: '/whiteboards/:id/leave', type: 'board.leave', status: 204 }`.

- [ ] **Step 4: Run tests, whole API package**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): board.leave removes the caller's own membership"
```

---

### Task 6: API: provisioning creates the first board only with the user record

**Files:**

- Modify: `apps/api/src/plugins/auth.ts` (`provisionUser`, the preHandler's reads and `upToDate`)
- Test: `apps/api/test/me.test.ts` (the "recreates a deleted board…" test, lines ~199–214)

- [ ] **Step 1: Rewrite the failing test**

Replace that test with:

```ts
// Deleting your last board is allowed (RFC BOARD_HOME §3); the next request must not quietly
// hand you a fresh "Meine Wand".
it('does not recreate a board that was deleted', async () => {
  const token = registerTestUser(ctx, 'me-rebuild', 'rebuild@example.com');
  await ctx.inject({ method: 'GET', url: '/me', headers: ctx.authHeader(token) });
  await whiteboardsCol(ctx.db).doc('me-rebuild').delete();

  await ctx.inject({
    method: 'GET',
    url: '/me',
    headers: { ...ctx.authHeader(token), ...EN_HEADER },
  });

  expect((await whiteboardsCol(ctx.db).doc('me-rebuild').get()).exists).toBe(false);
  const list = await ctx.inject({
    method: 'GET',
    url: '/whiteboards',
    headers: ctx.authHeader(token),
  });
  expect(list.json()).toEqual([]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `docker compose run --rm api pnpm --filter @wally/api test -- test/me.test.ts`
Expected: FAIL (board exists again).

- [ ] **Step 3: Implement**

In `provisionUser`: drop the `boardRef` get from the `Promise.all`; create the board inside `if (!existing) { … }` only (keep `INITIAL_BOARD_NAME[signupLanguage]`, id = uid, `revision: 1`). Remove the `boardLanguage` logic and the comment about a deleted board. In the preHandler: read only `usersCol(db).doc(decoded.uid)`; `upToDate` drops `boardSnapshot.exists`. Rewrite the two comments that say "one whiteboard per owner is a property of the key space" to: "The first board shares the user's uid as its id. Later boards get generated ids; nothing reads meaning into the uid-keyed one any more (RFC BOARD_HOME §12.3)." Update the preHandler doc comment to "one document read".

- [ ] **Step 4: Run the whole API package**

Expected: PASS, including `invite-security.test.ts` "stops rewriting the user record once the caller is in steady state" and `auth.test.ts` lazy provisioning.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): provision the first board only with a new user record"
```

---

### Task 7: Web: sign-out clears the return path; sign-in hands it to the landing

**Files:**

- Create: `apps/web/src/features/auth/returnPath.ts`
- Modify: `apps/web/src/features/auth/AuthProvider.tsx` (`signedOut` in context)
- Modify: `apps/web/src/features/auth/ProtectedRoute.tsx`
- Modify: `apps/web/src/features/auth/SignInForm.tsx` (lines 48, 72, 85, 164), `SignUpForm.tsx` (46, 71, 84, 182–188)
- Modify: `apps/web/src/routes/LoginPage.tsx`, `SignupPage.tsx`
- Test: `apps/web/src/features/auth/ProtectedRoute.test.tsx`, `AuthProvider.test.tsx`, `apps/web/src/features/auth/returnPath.test.ts` (new)

**Interfaces:**

- Produces: `AuthContextValue.signedOut: boolean` — true from the moment a signed-in account became signed out in this page, false once someone is authenticated again.
- Produces: `returnPath.ts`:

  ```ts
  /** The in-app path a visitor was sent to /login from, or null. Only absolute in-app paths count. */
  export function readReturnPath(state: unknown): string | null;
  /** Where sign-in and sign-up navigate: the landing, carrying the return path for it to validate. */
  export function landingWithReturn(from: string | null): {
    pathname: '/';
    state: { to: string | null };
  };
  ```

  `readReturnPath` returns the string only if it starts with a single `/` (not `//`) and is `/share/…` or `/boards/…`; everything else is null.

- [ ] **Step 1: Write the failing tests**

`returnPath.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readReturnPath } from './returnPath';

describe('readReturnPath', () => {
  it('accepts share links and board paths', () => {
    expect(readReturnPath({ from: '/share/tok' })).toBe('/share/tok');
    expect(readReturnPath({ from: '/boards/abc?view=list' })).toBe('/boards/abc?view=list');
  });
  it('ignores anything that is not one of those', () => {
    for (const from of [
      '//evil.example',
      'https://evil.example',
      'javascript:alert(1)',
      '/login',
      '/',
      '',
      undefined,
    ])
      expect(readReturnPath({ from })).toBeNull();
    expect(readReturnPath(null)).toBeNull();
  });
});
```

`ProtectedRoute.test.tsx`: change the login stub to print the state and add:

```tsx
function LoginStub() {
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  return <div>Login-Seite {from ?? 'ohne Rückweg'}</div>;
}
...
  it('remembers where the visitor was going when nobody was signed in', () => {
    mockUseAuth.mockReturnValue({ status: 'unauthenticated', signedOut: false });
    renderProtected('/boards/1');
    expect(screen.getByText('Login-Seite /boards/1')).toBeInTheDocument();
  });
  it('forgets the previous account’s board after a sign-out', () => {
    mockUseAuth.mockReturnValue({ status: 'unauthenticated', signedOut: true });
    renderProtected('/boards/1');
    expect(screen.getByText('Login-Seite ohne Rückweg')).toBeInTheDocument();
  });
```

`AuthProvider.test.tsx`: following its `listener.current(user)` style, add a test that reports a user, then `null`, and expects `result.current.signedOut` to be `true`; then reports a user again and expects `false`; and one that the initial `null` report leaves it `false`.

- [ ] **Step 2: Run to verify they fail**

Run: `docker compose run --rm api pnpm --filter @wally/web test -- src/features/auth`
Expected: FAIL.

- [ ] **Step 3: Implement**

`returnPath.ts`:

```ts
const ALLOWED = /^\/(share|boards)\/[^/]/;
export function readReturnPath(state: unknown): string | null {
  const from = (state as { from?: unknown } | null)?.from;
  return typeof from === 'string' &&
    from.startsWith('/') &&
    !from.startsWith('//') &&
    ALLOWED.test(from)
    ? from
    : null;
}
export function landingWithReturn(from: string | null) {
  return { pathname: '/' as const, state: { to: from } };
}
```

`AuthProvider.tsx`: `const [signedOut, setSignedOut] = useState(false);` In the `!firebaseUser` branch: `setSignedOut(typeof previousUid === 'string');` In the authenticated success path: `setSignedOut(false);` Add to the context value and its `useMemo` deps.

`ProtectedRoute.tsx`: `const { status, signedOut } = useAuth();` and `state={signedOut ? null : { from: location.pathname + location.search }}`.

`SignInForm.tsx` and `SignUpForm.tsx`: `const from = readReturnPath(location.state);` and both `navigate(from, { replace: true })` become `const target = landingWithReturn(from); navigate(target.pathname, { replace: true, state: target.state });`. The cross links keep `state={{ from }}`.

`LoginPage.tsx` / `SignupPage.tsx`: replace the `from` line and the `Navigate` with `const target = landingWithReturn(readReturnPath(location.state)); if (status === 'authenticated') return <Navigate to={target.pathname} state={target.state} replace />;`.

- [ ] **Step 4: Run tests**

Expected: PASS. Also run `src/routes/ShareRedeemPage.test.tsx` (it asserts the `/share/…` return path reaches the login stub; unchanged behaviour).

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "fix(web): a sign-out never hands the next account the previous board as return path"
```

---

### Task 8: Web: landing resolver at `/`

**Files:**

- Rename: `apps/web/src/routes/RootRedirect.tsx` → `apps/web/src/routes/LandingPage.tsx` (`git mv`)
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/i18n/de.ts`, `en.ts` (`routes.root.*`)
- Test: `apps/web/src/routes/LandingPage.test.tsx` (new)

**Interfaces:**

- Produces: `LandingPage()` resolving per §5.3 and §6. Reads `location.state.to`.

- [ ] **Step 1: Write the failing tests**

Model on `ShareRedeemPage.test.tsx` (mock `boardsApi.list`, stub routes). Cases:

```tsx
vi.mock('@/lib/resources', () => ({ boardsApi: { list: vi.fn() } }));
import { boardsApi } from '@/lib/resources';
function Where() { const l = useLocation(); return <div>{l.pathname}</div>; }
function render(route: string, state?: unknown) {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/boards" element={<Where />} />
      <Route path="/boards/:id" element={<Where />} />
      <Route path="/share/:token" element={<Where />} />
    </Routes>,
    { route, state },   // extend renderWithProviders to accept initialEntries with state
  );
}
it('goes to the one board a single-board user has', …)                     // [own] → /boards/own
it('goes home with two or more boards', …)                                 // → /boards
it('goes home with no boards', …)                                          // → /boards
it('follows a share link return path', …)                                   // to:/share/t → /share/t
it('follows a board return path the caller can open', …)                    // to:/boards/shared, list has shared → /boards/shared
it('drops a board return path the caller cannot open', …)                   // to:/boards/other, list [own] → /boards/own
it('drops a return path that is not an in-app path', …)                     // to:'https://evil.example' with 2 boards → /boards
it('shows the retry state when the list fails', …)                          // list rejects → button 'Erneut versuchen'
```

`renderWithProviders` gains an optional `state` that becomes `initialEntries={[{ pathname: route, state }]}`.

- [ ] **Step 2: Run to verify they fail**

Expected: FAIL (file missing).

- [ ] **Step 3: Implement**

`LandingPage.tsx`:

```tsx
/** `/` shows nothing itself. It waits for the board list and sends the caller on: to the
 * return path sign-in handed over if it is a share link or a board on the list, else by count
 * (RFC BOARD_HOME §5, §6). The home (/boards) is the only route that lists boards; this one
 * never renders a choice. */
export function LandingPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const { data: boards, isLoading, isError, refetch } = useBoards();
  if (isLoading) return <AppSkeleton />;
  if (isError) return ( …existing CloudOff retry block with t('routes.root.loadFailed')… );
  const to = readReturnPath({ from: (location.state as { to?: unknown } | null)?.to });
  if (to?.startsWith('/share/')) return <Navigate to={to} replace />;
  if (to && boards?.some((b) => `/boards/${b.id}` === to.split('?')[0])) return <Navigate to={to} replace />;
  if (boards?.length === 1) return <Navigate to={`/boards/${boards[0]!.id}`} replace />;
  return <Navigate to="/boards" replace />;
}
```

`useMe` and the `noBoardTitle/noBoardBody` empty state are removed from this file; delete those two keys from both catalogues (the home owns the empty state now). `App.tsx`: import `LandingPage` in place of `RootRedirect`. Keep `/boards` out of `App.tsx` until Task 10 (the test stubs it).

- [ ] **Step 4: Run tests** → PASS. Also `src/i18n/resources.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): the landing validates the return path and routes by board count"
```

---

### Task 9: Web: API client, resources and the three mutations

**Files:**

- Modify: `apps/web/src/lib/apiClient.ts` (`request()`: predicates after line ~117, `isBoardMutation`, header exclusion line ~132, the `!res.ok` throw line ~140, the ticket block lines ~167–171, the `action` ternary line ~181, `loadLatest`'s 404 catch line ~209)
- Modify: `apps/web/src/lib/resources.ts` (`boardsApi`, lines 60–66)
- Modify: `apps/web/src/features/board/hooks/mutations/shared.ts` (new `removeBoardFromCaches`)
- Create: `apps/web/src/features/board/hooks/mutations/useCreateBoard.ts`, `useDeleteBoard.ts`, `useLeaveBoard.ts`
- Modify: `apps/web/src/i18n/de.ts`, `en.ts` (`safety.actions.deleteBoard`, `safety.actions.leaveBoard`)
- Test: `apps/web/src/lib/apiClient.test.ts` (exists; extend), `apps/web/src/lib/resources.test.ts` (exists; extend), `apps/web/src/features/board/hooks/mutations/useBoardLifecycle.test.tsx` (new)

**Design decision (from the queue's actual behaviour):** `enqueueMutation` treats _every_ thrown error, 4xx included, as an unsaved change: it blocks the `board:<id>` lane and shows the "Unsaved changes" chip with Retry.

- **Delete and leave go through the queue** on lane `board:<id>`. Delete carries the board revision by design (§12.1); `STALE_REVISION` must open the existing review dialog, and a delete queued behind an in-flight rename must be rebased by the lane's transitions. Re-implementing that in a hook would be a second copy. The one wart, a 404 on a retry after the first attempt succeeded, is mapped to success **inside `perform`** so the queue sees a resolved send and clears the recovery.
- **Create bypasses the queue.** Its only interesting failure is `422 BOARD_LIMIT_REACHED`, which the dialog shows itself; a recovery chip with a Retry button would be wrong and would outlive the dialog. Create still mints a ticket so `Idempotency-Key` is sent, and the hook reuses the ticket while the typed name is unchanged, so a user-driven retry replays the receipt.

**Interfaces:**

- Produces in `apiClient.ts`: predicates `createsBoard` (`POST /whiteboards`), `deletesBoard` (`DELETE /whiteboards/:id`), `leavesBoard` (`POST /whiteboards/:id/leave`); `action` labels `'deleteBoard'` and `'leaveBoard'`.
- Produces:
  ```ts
  boardsApi.create(name: string, ticket?: MutationTicket): Promise<WhiteboardDto>   // POST /whiteboards, body parsed with whiteboardCreateSchema
  boardsApi.remove(boardId: string, ticket?: MutationTicket): Promise<void>         // DELETE /whiteboards/:id
  boardsApi.leave(boardId: string): Promise<void>                                   // POST /whiteboards/:id/leave, body {}
  ```
- Produces in `shared.ts`: `removeBoardFromCaches(queryClient, keys, boardId)` — removes the board from the `keys.meBoards()` list and `removeQueries({ queryKey: keys.board(boardId) })` (prefix match drops notes, members, invites, shareLink).
- Produces hooks:

  ```ts
  useCreateBoard(): UseMutationResult<WhiteboardDto, ApiError, { name: string }>   // meta.silentError; ticket reused while name unchanged
  useDeleteBoard(boardId: string): UseMutationResult<void, Error, void>            // ensures keys.board(boardId) then captureBoardMutation(...)
  useLeaveBoard(boardId: string): UseMutationResult<void, Error, void>             // no ticket, no revision
  ```

- [ ] **Step 1: Write the failing tests**

`apiClient.test.ts` (copy the file's existing fetch-spy setup):

```ts
it('creates a board with an operation id, no expected revision, and no recovery on failure', async () => {
  fetchMock.mockResolvedValueOnce(json(422, { error: 'BOARD_LIMIT_REACHED', message: 'limit' }));
  await expect(boardsApi.create('Zu viel')).rejects.toMatchObject({ code: 'BOARD_LIMIT_REACHED' });
  const headers = lastHeaders();
  expect(headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
  expect(headers['X-Expected-Revision']).toBeUndefined();
  expect(getRecoveries()).toEqual([]);
});
it('sends no expected revision when leaving, even if the board revision is known', async () => {
  rememberResource('board:b', 3);
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
  await boardsApi.leave('b');
  expect(lastHeaders()['X-Expected-Revision']).toBeUndefined();
  expect(lastHeaders()['Idempotency-Key']).toBeDefined();
});
it('treats 404 on delete or leave as already gone and leaves no recovery', async () => {
  rememberResource('board:b', 3);
  fetchMock.mockResolvedValueOnce(json(404, { error: 'NOT_FOUND', message: 'Not found' }));
  await expect(
    boardsApi.remove('b', captureMutation('board:b', { revision: 3 })),
  ).resolves.toBeUndefined();
  expect(getRecoveries()).toEqual([]);
  expect(isMutationPending('board:b')).toBe(false);
});
it('unblocks the lane when a retried delete finds the board already gone', async () => {
  rememberResource('board:b', 3);
  fetchMock.mockRejectedValueOnce(new TypeError('offline'));
  await expect(
    boardsApi.remove('b', captureMutation('board:b', { revision: 3 })),
  ).rejects.toThrow();
  const [recovery] = getRecoveries();
  expect(recovery?.description?.action).toBe('deleteBoard');
  fetchMock.mockResolvedValueOnce(json(404, { error: 'NOT_FOUND', message: 'Not found' }));
  await retryMutation(recovery!.ticket.operationId);
  expect(getRecoveries()).toEqual([]);
});
```

`json(status, body)` and `lastHeaders()` are the file's own helpers (add them if the file names them differently).

`useBoardLifecycle.test.tsx` (`renderHook` with a `QueryClientProvider`; `vi.mock('@/lib/resources')`):

```ts
it('useCreateBoard adds the new board to the list and primes its board cache', …)   // list cache gains {id,name,currentUserRole:'OWNER'}; keys.board(id) set
it('useCreateBoard reuses the ticket for the same name and mints a new one for a new name', …)  // two calls 'A','A' → same Idempotency ticket; 'B' → different
it('useDeleteBoard removes the board from the list at once and drops its caches on success', …)
it('useDeleteBoard brings the row back when the request fails', …)                 // remove rejects → onSettled invalidates; list refetched with the board
it('useLeaveBoard removes the board from the list and drops its caches', …)
```

- [ ] **Step 2: Run to verify they fail**

Run: `docker compose run --rm api pnpm --filter @wally/web test -- src/lib/apiClient.test.ts src/features/board/hooks/mutations`
Expected: FAIL.

- [ ] **Step 3: Implement**

`apiClient.ts`, after `redeemsLink`:

```ts
const createsBoard = method === 'POST' && path === '/whiteboards';
const deletesBoard = method === 'DELETE' && /^\/whiteboards\/[^/]+$/.test(path);
const leavesBoard = method === 'POST' && /^\/whiteboards\/[^/]+\/leave$/.test(path);
```

- `isBoardMutation`: append `|| createsBoard`.
- Header exclusion: `!createsNote && !redeemsLink && !createsBoard && !leavesBoard`.
- In `perform`, before `if (!res.ok)`:
  ```ts
  // A board that is already gone (deleted from another tab, membership already removed, or
  // the retry of a request that did succeed) is the end state delete and leave ask for.
  if (res.status === 404 && (deletesBoard || leavesBoard))
    return { data: undefined as T, revision: metadata?.expectedRevision ?? 0 };
  ```
- Ticket block: lane `create:<uuid>` when `createsNote || redeemsLink || createsBoard`; then
  ```ts
  // Create carries no draft to recover and must not raise the unsaved-changes chip: the
  // dialog shows its own error. It keeps the operation id so a user-driven retry replays.
  if (createsBoard) return (await perform({ operationId: ticket.operationId })).data;
  ```
- `action` ternary: insert `: deletesBoard ? 'deleteBoard' : leavesBoard ? 'leaveBoard'` **before** the `method === 'DELETE' ? 'delete'` branch.
- `loadLatest` catch: add `if (error instanceof ApiError && error.status === 404 && (deletesBoard || leavesBoard)) return { data: null, revision: 0 };` before the existing rethrow condition.

`resources.ts`:

```ts
  create: (name, ticket) => api.post('/whiteboards', whiteboardCreateSchema.parse({ name }), whiteboardDtoSchema, ticket),
  remove: (boardId, ticket) => api.delete(`/whiteboards/${boardId}`, undefined, ticket),
  leave: (boardId) => api.post(`/whiteboards/${boardId}/leave`, {}),
```

i18n `safety.actions`: `deleteBoard: 'Wand löschen'` / `'Delete board'`, `leaveBoard: 'Wand verlassen'` / `'Leave board'`.

`shared.ts`:

```ts
export function removeBoardFromCaches(queryClient: QueryClient, keys: QueryKeys, boardId: string) {
  queryClient.setQueryData<WhiteboardSummaryDto[]>(keys.meBoards(), (prev) =>
    prev?.filter((b) => b.id !== boardId),
  );
  queryClient.removeQueries({ queryKey: keys.board(boardId) });
}
```

`useCreateBoard.ts`: `attempt = useRef<{ name: string; ticket: MutationTicket } | null>(null)`; in `mutationFn({ name })` reuse `attempt.current.ticket` when the name matches and `isCurrentSession(ticket.generation)`, else `captureMutation(\`create:${crypto.randomUUID()}\`)`; `meta: { silentError: true }`; `onSuccess(board)`: clear the ref, append `{ id, name, currentUserRole: 'OWNER' }`to`keys.meBoards()`, `setQueryData(keys.board(board.id), board)`, invalidate `keys.meBoards()`.

`useDeleteBoard.ts`: `mutationFn: async () => { await queryClient.ensureQueryData({ queryKey: keys.board(boardId), queryFn: () => boardsApi.get(boardId) }); return boardsApi.remove(boardId, captureBoardMutation(queryClient, keys, boardId)); }` (without the ensure step an empty cache would send revision 0 and 409 every time); `onMutate`: cancel + filter the list; `onSuccess`: `removeBoardFromCaches`; `onSettled`: invalidate `keys.meBoards()`. No `silentError`: the chip and the global toast report failures like note delete.

`useLeaveBoard.ts`: `mutationFn: () => boardsApi.leave(boardId)`; same `onMutate`/`onSuccess`/`onSettled`.

- [ ] **Step 4: Run tests** → PASS, including the existing `apiClient.test.ts` cases ("reuses headers and payload through authentication refresh…", "resolves the proposed assignee…"), `mutationQueue.test.ts`, `resources.test.ts`, `MutationRecovery.test.tsx`, `i18n/resources.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): create, delete and leave board mutations"
```

---

### Task 10: Web: the board home at `/boards`

**Files:**

- Create: `apps/web/src/routes/BoardsPage.tsx`, `apps/web/src/features/boards/HomeShell.tsx`, `BoardHome.tsx`, `BoardRow.tsx`, `NewBoardDialog.tsx`, `DeleteBoardDialog.tsx`, `LeaveBoardDialog.tsx`
- Modify: `apps/web/src/App.tsx` (route `/boards` inside `ProtectedRoute`)
- Modify: `apps/web/src/features/board/AccountMenu.tsx` (`shortcuts?: boolean` prop, default true)
- Modify: `apps/web/src/i18n/de.ts`, `en.ts` (new `home.*` block)
- Test: `apps/web/src/features/boards/BoardHome.test.tsx`, `NewBoardDialog.test.tsx`

**Interfaces:**

- Produces: `NewBoardDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void })` — one field prefilled with `INITIAL_BOARD_NAME[language]`, submit disabled while trimmed name is empty, calls `useCreateBoard` (which reuses its ticket while the name is unchanged), navigates to `/boards/${id}` on success, shows `home.create.limitReached` on `ApiError.code === 'BOARD_LIMIT_REACHED'` and `home.create.failed` otherwise. Reused by Task 11.
- Produces: `DeleteBoardDialog({ board, open, onOpenChange })` with `board: WhiteboardSummaryDto & { revision?: number }` — mounts `useBoard(board.id)` so the delete hook finds the revision cached, and `useNotes(open ? board.id : undefined)` for the count; `AlertDialog` with `AlertDialogAction variant="destructive"`; confirm calls `useDeleteBoard(board.id).mutate()`.
- Produces: `LeaveBoardDialog({ board, open, onOpenChange })`.
- Produces: `BoardRow({ board, onDelete, onLeave })` — whole row a `Link`, trailing overflow `Popover` with one `MenuItem` (`destructive`), 44 px targets on coarse pointers.
- Produces: `HomeShell({ children })` — header with `BrandMark` (static here), spacer, `AccountMenu shortcuts={false}`; `flex h-[100dvh] flex-col` with a `wally-scroll overflow-y-auto` main.

**Copy (de.ts is authoritative; en.ts mirrors):**

```ts
home: {
  title: 'Deine Wände',                    // 'Your boards'
  shared: 'Mit dir geteilt',               // 'Shared with you'
  continue: 'Weitermachen',                // 'Continue'
  open: '{{name}} öffnen',                 // 'Open {{name}}'   (row aria-label)
  rowMenu: 'Optionen für {{name}}',        // 'Options for {{name}}'
  newBoard: 'Neue Wand',                   // 'New board'
  empty: { title: 'Noch keine Wände', hint: 'Lege eine an, um Notizen zu platzieren.' },   // 'No boards yet' / 'Create one to start placing notes.'
  create: {
    title: 'Neue Wand', nameLabel: 'Name', submit: 'Anlegen',          // 'New board','Name','Create'
    limitReached: 'Du hast die Grenze von {{count}} Wänden erreicht.',   // 'You have reached the limit of {{count}} boards.'
    failed: 'Die Wand konnte nicht angelegt werden. Bitte versuche es noch einmal.',
  },
  delete: {
    action: 'Wand löschen',                                                       // 'Delete board'
    title: '„{{name}}“ löschen?',                                                 // 'Delete “{{name}}”?'
    body_one: 'Das entfernt die Wand, ihre {{count}} Notiz und den Zugang aller Mitglieder. Das lässt sich nicht rückgängig machen.',
    body_other: 'Das entfernt die Wand, ihre {{count}} Notizen und den Zugang aller Mitglieder. Das lässt sich nicht rückgängig machen.',
    bodyCounting: 'Das entfernt die Wand, ihre Notizen und den Zugang aller Mitglieder. Das lässt sich nicht rückgängig machen.',
    confirm: 'Wand löschen',
  },
  leave: {
    action: 'Wand verlassen',                                                     // 'Leave board'
    title: '„{{name}}“ verlassen?',
    body: 'Du brauchst eine neue Einladung oder einen Freigabelink, um zurückzukommen. Dir zugewiesene Notizen auf dieser Wand werden freigegeben.',
    confirm: 'Wand verlassen',
  },
},
```

`routes.home.loadFailed: 'Deine Wände konnten nicht geladen werden.'`

- [ ] **Step 1: Write the failing tests**

`BoardHome.test.tsx` (mock `boardsApi.list`, `meApi.get` for `lastBoardId`, `notesApi.list`; language de):

```ts
it('lists own boards first, then shared ones with their role', …)          // headings order; 'Ansehen' on VIEW row
it('shows a continue card for the remembered board when it is on the list', …)
it('shows no continue card when the remembered board is gone', …)         // lastBoardId 'gone' → queryByText('Weitermachen') null
it('shows the empty state with a create action when there are no boards', …)
it('offers delete on own rows and leave on shared rows, never both', …)    // open row menu, assert the single item
it('opens the delete confirmation with the board name and note count', …)  // notesApi.list resolves 3 notes → body contains '3 Notizen'
```

`NewBoardDialog.test.tsx`:

```ts
it('is prefilled with the initial board name and creates on Enter', …)     // create called with 'Meine Wand', navigates to /boards/new-id
it('disables submit for a whitespace-only name', …)
it('shows the limit message on BOARD_LIMIT_REACHED', …)                    // create rejects ApiError(422, { error: 'BOARD_LIMIT_REACHED' })
it('reuses one operation id across a retry', …)                            // first reject (500), click retry → both calls same operationId
```

- [ ] **Step 2: Run to verify they fail** → FAIL (files missing).

- [ ] **Step 3: Implement**

`BoardHome.tsx` composition: `useBoards()`, `useMe()`; `own = boards.filter(OWNER).sort(byName(locale))`, `shared = the rest sorted`; `continueBoard = boards.find(b => b.id === lastBoardId)`; sections per §7.1; `EmptyState` per §7.4 with `<Button variant="accent">` New board (the only accent on the page; the top-bar New board button is `outline`). Dialog state: `const [dialog, setDialog] = useState<null | { kind: 'create' } | { kind: 'delete' | 'leave'; board }>(null)`. Loading: `AppSkeleton`; error: `EmptyState` + retry with `routes.home.loadFailed`.

`BoardsPage.tsx`: `<HomeShell><BoardHome /></HomeShell>`. `App.tsx`: `<Route path="/boards" element={<ProtectedRoute><BoardsPage /></ProtectedRoute>} />` before `/boards/:boardId`.

`AccountMenu.tsx`: render the shortcuts `MenuItem` only when `shortcuts` is true (the listener lives in `BoardCommands`, mounted only inside a board).

- [ ] **Step 4: Run tests** → PASS; `resources.test.ts`, `noHardcodedCopy.test.ts` PASS.

- [ ] **Step 5: Verify in the browser**

`make up`, sign in as the E2E user in the in-app browser (the user signs in; viewport ≤ 1200 px), open `/boards`, check: list, create, delete, leave on a shared board, mobile width, dark mode, no console errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): board home with create, delete and leave"
```

---

### Task 11: Web: in-board navigation and not-found copy

**Files:**

- Modify: `apps/web/src/features/board/TopBar.tsx` (lines ~202–209 brand mark; ~248 switcher)
- Modify: `apps/web/src/features/board/BoardSwitcher.tsx`
- Modify: `apps/web/src/routes/NotFoundPage.tsx` (no code change; copy only), `apps/web/src/i18n/de.ts`, `en.ts`
- Test: `apps/web/src/features/board/BoardSwitcher.test.tsx`, `apps/web/src/routes/BoardPage.test.tsx` (new)

- [ ] **Step 1: Update and add tests**

`BoardSwitcher.test.tsx`: replace the first test ("stays out of the way…") with "offers All boards and New board even with a single board": one board → button 'Wand wechseln' present → menu contains link 'Alle Wände' with href `/boards` and button 'Neue Wand'. Keep the other two tests.

`BoardPage.test.tsx`: mock `boardsApi.get` to reject `new ApiError(404, null)` → not-found page renders with link 'Zurück zu deinen Wänden' whose href is `/`.

- [ ] **Step 2: Run to verify they fail** → FAIL.

- [ ] **Step 3: Implement**

`TopBar.tsx`: wrap the brand mark: `<Link to="/boards" aria-label={t('board.topBar.home')} className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)]"><BrandMark size={20} /></Link>`; copy `board.topBar.home: 'Zu deinen Wänden'` / `'To your boards'`.

`BoardSwitcher.tsx`: remove the `boards.length < 2` early return (return null only while `!boards`); after the list add `<MenuSeparator />`, a `<Link to="/boards">` row styled like the board rows with text `board.switcher.all` ('Alle Wände' / 'All boards'), and a `<MenuItem icon={<Plus />} onClick={() => setCreating(true)}>` with `home.newBoard`; render `<NewBoardDialog open={creating} onOpenChange={setCreating} />`. Close the popover before opening the dialog (controlled `open` state on `Popover`).

Copy: `routes.notFound.action: 'Zurück zu deinen Wänden'` / `'Back to your boards'`.

- [ ] **Step 4: Run tests** → PASS (watch the 20 s default timeout; nested Radix layers may need `60_000`).

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): reach the board home from every board"
```

---

### Task 12: E2E

**Files:**

- Modify: `apps/web/e2e/support.ts`
- Create: `apps/web/e2e/boards.spec.ts`
- Modify: `apps/web/e2e/README.md`, `.github/workflows/ci.yml` (line 209 `MIN_EXECUTED`)

Note: the RFC §15 asks for a sign-out-then-sign-in-as-another-user E2E case. There is one E2E credential pair and creating a second Firebase account is the user's to do; the cross-account case is pinned by the component tests in Tasks 7 and 8 instead, and listed under "What to tell the user" below.

- [ ] **Step 1: Make `signIn` robust to landing on the home**

```ts
export async function signIn(page: Page) {
  … existing fill + click …
  await page.waitForURL(/\/boards(\/.+)?$/);
  // A previous run may have left a second board behind; the seeded one is always "Meine Wand".
  if (new URL(page.url()).pathname === '/boards') {
    await page.getByRole('link', { name: 'Meine Wand öffnen' }).first().click();
    await page.waitForURL(/\/boards\/.+/);
  }
}
```

- [ ] **Step 2: Write `boards.spec.ts`** (one happy path, German UI):

```ts
test('creating, landing on, and deleting a second board', async ({ page }) => {
  test.skip(!hasE2eCredentials, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');
  await signIn(page);
  const name = `E2E ${Date.now()}`;
  await page.getByRole('button', { name: 'Wand wechseln' }).click();
  await page.getByRole('button', { name: 'Neue Wand' }).click();
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await page.waitForURL(/\/boards\/.+/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);

  await page.getByRole('link', { name: 'Zu deinen Wänden' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Deine Wände');
  await expect(page.getByText('Weitermachen')).toBeVisible();

  await page.getByRole('button', { name: `Optionen für ${name}` }).click();
  await page.getByRole('button', { name: 'Wand löschen' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Wand löschen' }).click();
  await expect(page.getByRole('link', { name: `${name} öffnen` })).toHaveCount(0);
});
```

Put the delete in a `finally`-style cleanup (`test.afterEach` that deletes any row whose name starts with `E2E `) so a failed run does not leave the user on the home for the other specs.

- [ ] **Step 3: CI and README**

`ci.yml`: `MIN_EXECUTED: '7' # 6 under chromium-desktop + 1 under mobile-list-only`. README: mention that the suite creates and deletes a board named `E2E <timestamp>`.

- [ ] **Step 4: Run locally**: `make up && make seed && make e2e` with the credentials exported. Expected: all pass. (CI is the real proof; see memory `project_wally_e2e_credentials`.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e .github/workflows/ci.yml
git commit -m "test(e2e): create, land on and delete a second board"
```

---

### Task 13: Documentation and ADR

**Files:**

- Modify: `docs/SPEC.md` (§2, §4a, §9, §14; new §4b)
- Modify: `docs/architecture/overview.md` (person description; `whiteboards/{id}` row)
- Modify: `docs/architecture/board-operations.md` (table rows; `board.delete` cleanup kind)
- Modify: `docs/GDPR.md` (inventory row for `whiteboards/{id}`; GAP-01 text; checklist)
- Modify: `docs/README.md` (proposals row), `docs/rfcs/0002-board-home.md` (status line)
- Create: `docs/adr/0011-boards-as-independent-aggregates.md` (template `0000-template.md`)

- [ ] **Step 1: SPEC.md**
  - §2: "The whiteboard is owned by one user." → "Each whiteboard is owned by one user. A user may own several and be a member of others."
  - §4a: replace "Opening the app returns to the board the user last had open." with "Opening the app goes straight into the user's only board, or to the board home when they have none or several; the home marks the board last opened (see §4b)."
  - New §4b "Boards": condensed §5 to §11 of the RFC (landing rule table, home layout, create with the limit, delete with cleanup, leave, top-bar navigation).
  - §9: add "A member can leave a shared board. Notes assigned to them are unassigned."
  - §14: delete "Multiple whiteboards per user".
- [ ] **Step 2: overview.md**: person node "Owns one or more whiteboards, may be a member of others"; data-model row: "The first board's id is the owner's uid; later boards have generated ids. `deletedAt` marks a board awaiting cleanup."
- [ ] **Step 3: board-operations.md**: add rows `New board | board.create | any user | None`, `Board | board.delete | OWNER | Board`, `Membership | board.leave | ACTIVE EDIT/VIEW | None`; mention the `board.delete` cleanup kind next to `member.remove`; note that `board.create` is bounded by `MAX_OWN_BOARDS` and the global rate limit and has no per-route limit (a deviation from RFC §12.1, recorded here and in the RFC's status line).
- [ ] **Step 4: GDPR.md**: add a `whiteboards/{id}` row (name, ownerId, memberRoles, deletedAt; "Deleted when: the owner deletes the board; cleanup removes notes, members and the share link"); GAP-01 first paragraph: "No `DELETE /me`. Boards can be deleted by their owner (`board.delete`), so the gap is now account erasure…"; keep the plan steps.
- [ ] **Step 5: ADR-0011** "Boards are independent aggregates": context (uid-keyed single board), decision (generated ids for later boards, tombstone + cleanup, leave, provisioning only with the user record), consequences (no migration; `liveWhiteboard` is the one read path; replay after deletion is 404 by design). Status accepted, date 2026-10-14. Add to `docs/adr/README.md` index.
- [ ] **Step 6: README.md / RFC**: README proposals row drops BOARD_HOME; RFC status becomes "**Status:** accepted 2026-10-14; §5 to §12 live in [`SPEC.md` §4b](../../SPEC.md) and [ADR-0011](../../adr/0011-boards-as-independent-aggregates.md). Kept for the reasoning and the alternatives considered."
- [ ] **Step 7: `pnpm format:check`, then commit**

```bash
git add docs
git commit -m "docs: boards as independent aggregates; board home in the spec"
```

---

### Task 14: Final verification and PR

- [ ] `make test`, `make lint`, `make typecheck`, `pnpm format:check` all green.
- [ ] Manual pass in the running app (user signs in to the in-app browser): the acceptance criteria §16.1 (two accounts if available), 4, 5, 6, 7, 8, 9; dark mode; 375 px width.
- [ ] Push `feat/board-home`, open a PR with the template filled, `MIN_EXECUTED` noted under "Anything reviewers should know". Check `gh auth status` first (memory `project_wally_gh_account_mismatch`). The user merges and releases.

## Verification summary

- API: `boards-lifecycle.test.ts` covers create (limit, replay, validation), delete (roles, tombstone, cleanup, failure retention, stale revision, retry-after-completion), leave (roles, cleanup, retry); `whiteboards.test.ts` and `authorization.test.ts` cover the tombstone read helper; `me.test.ts` covers provisioning.
- Web: `returnPath`, `ProtectedRoute`, `AuthProvider` (sign-out flag), `LandingPage` (eight routing cases incl. hostile paths), `apiClient` (create bypasses the queue, leave sends no revision, 404 as gone on delete/leave, lane unblocked on retry), hooks (cache updates), `BoardHome`, `NewBoardDialog`, `BoardSwitcher`, `BoardPage` not-found.
- E2E: `boards.spec.ts` happy path; CI gate raised to 7.
- Browser: Task 10 Step 5 and Task 14.

## What to tell the user at the end

- The cross-account sign-out case is proven by component tests, not E2E, because a second Firebase test account and secret pair would be needed; creating accounts is theirs to do.
- `board.create` has no per-route rate limit, unlike the RFC's "rate-limited like invites": the own-board cap bounds it, and a per-route bucket would make the limit tests flaky. The deviation is recorded in board-operations.md and the RFC.
- ADR-0011 records the stored-shape change (`deletedAt`, generated board ids), which SETUP.md lists under "ask before you do"; the RFC approval covered it.
