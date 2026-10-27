# Assistant Operations Layer Implementation Plan

> **Status:** executed in PR #39.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first slice of the Wally assistant: the operation set over the existing command layer, the deployment switch, provenance on receipts and history, and the audit record, all tested against the emulator, with no model involved yet.

**Architecture:** The operations are thin adapters in `apps/api/src/lib/assistant/`: a registry of names, input schemas and MCP annotations (`operations.ts`), and a runner (`run.ts`) that validates a call, binds it to one authorized board, and forwards reads to the query functions and writes to `executeBoardCommand`. The command layer gains an optional `provenance` on its options: it is stored on the receipt, folded into the idempotency fingerprint, copied into note history metadata, and produces one contents-free `assistantAudit` document in the same transaction. The deployment switch is one environment variable surfaced on the board response.

**Tech Stack:** TypeScript, Fastify + firebase-admin Firestore (API), Zod contract in `packages/shared`, Vitest against the Firestore emulator. No model library in this slice.

**Spec:** `docs/rfcs/0003-wally-agent.md` as of PR milad-luminull/wally#38, commit `c820a938`. It is not on this branch yet; read it at `/Users/mr_user/development/apps/wally-docs-rfc-agent/docs/rfcs/0003-wally-agent.md`. Section numbers below (§3.2, §3.3 …) refer to it. The command layer it builds on is documented in `docs/architecture/board-operations.md` and `docs/adr/0010-board-commands-revisions-and-receipts.md` on this branch.

## Context

The RFC requires every assistant write to go through `executeBoardCommand` (one entry point, transactional role and revision checks, receipts keyed by operation id) and every assistant change to be attributed with a contents-free audit record written in the same transaction. This slice builds exactly that surface and nothing model-facing: no routes, no conversations, no approvals. Later slices add the turn route, the approval record and the model boundary on top of `runOperation`.

Decisions taken for this plan, each with the spec text behind it:

- **Role filtering is the command layer's, not the registry's.** §3.2 "Roles hold" says the assistant offers exactly what the board allows the caller, and the board lets a VIEW member create and edit their own private notes (`rolesFor` in `apps/api/src/lib/commands/index.ts`). So the runner offers every operation and lets the transaction decide; a VIEW member's shared write fails there with 403. The panel layer turns that into the sentence the spec asks for.
- **`list_notes` is bounded at 100 rows** and reports `truncated` and `total` (§3.2 "Answers say when they are partial"). The number is a starting point.
- **`get_note` returns the detail without history.** History is for the note panel; the model needs fields and subtasks (§3.3 "tool output stays small" in the original design).
- **Provenance changes the fingerprint only when present**, so receipts written before this change still replay.
- **The audit document id is the operation id**, in a top-level `assistantAudit` collection, so a replay cannot create a second one and the record survives the note's deletion (§3.2 "Writes are attributed").

## Global Constraints

- Work only in `/Users/mr_user/development/apps/wally-assistant`, branch `feat/assistant-operations`. Never run git or edit files in `/Users/mr_user/development/apps/wally`: that checkout is bind-mounted into the running dev stack.
- Tests run on the host from the worktree against the live emulator, one command at a time, never two test runs concurrently, never `docker compose run`, never any `docker compose` command that touches the `firestore` service (it holds the user's real data in memory):

  ```bash
  cd /Users/mr_user/development/apps/wally-assistant/apps/api && FIRESTORE_EMULATOR_HOST=localhost:8080 FIREBASE_PROJECT_ID=luminull-wally NODE_ENV=test pnpm vitest run <file>
  ```

  Each emulator-backed test file declares its own `PROJECT_ID` (the `wally-test-*` convention in `apps/api/test/*.test.ts`) and resets only that project.

- Checks, all from the worktree root: `pnpm --filter @wally/shared typecheck`, `pnpm --filter @wally/api typecheck`, `pnpm --filter @wally/api lint`, `pnpm --filter @wally/web typecheck`, `pnpm format:check`. Fix formatting with `pnpm format`.
- No new dependency. No change to stored shapes beyond the two this plan names: the `provenance` field on receipts and the `assistantAudit` collection (approved 2026-10-15).
- Every write goes through `executeBoardCommand` with an operation id and, for existing notes, `expectedRevision`; never write Firestore from the assistant code (board-operations.md).
- Attribution fields (`via`, `conversationId`, `approvalId`) are trusted execution context supplied by the server, never read from an operation's input (§3.3).
- Error conventions: `AppError` from `apps/api/src/lib/errors.ts` with the existing codes `400 BAD_REQUEST`, `404 NOT_FOUND`, `403 FORBIDDEN`, `409 STALE_REVISION`, `409 IDEMPOTENCY_KEY_REUSED`.
- Conventional Commits; small commits; never commit to `main`. Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Prettier: single quotes, trailing commas, width 100 (`packages/config/prettier.config.js`).

## Review Focus

1. `list_notes` with `limit` equal to the number of matching notes reports `truncated: false`; one fewer reports `true` and `total` is the full count. Test in Task 4.
2. A note that exists on another board, requested with this board's id, is a 404 and never returns data, for reads and writes alike. Test in Task 4.
3. A replay of the same operation id with a different `approvalId` is refused with `409 IDEMPOTENCY_KEY_REUSED` and writes no second audit document. Test in Task 3.
4. A VIEW member creating a shared note through the runner gets 403; creating a private note succeeds with 201. Test in Task 4.
5. With the switch off, even a read operation is a 404. Test in Task 4.

---

### Task 1: Deployment switch and the effective flag on the board response

**Files:**

- Modify: `apps/api/src/env.ts` (the `envSchema` object)
- Modify: `packages/shared/src/schemas/board.ts` (`whiteboardDtoSchema`)
- Modify: `apps/api/src/lib/dto.ts` (`toWhiteboardDto`)
- Modify: `apps/web/src/test/fixtures.ts` (`makeBoard`)
- Modify: `apps/api/.env.example` and `.env.example`
- Test: `apps/api/test/whiteboards.test.ts`

**Interfaces:**

- Consumes: `loadEnv()` from `apps/api/src/env.ts`, cached once per process.
- Produces: `Env['ASSISTANT_ENABLED']: boolean` (default `false`); `WhiteboardDto.assistantEnabled: boolean`.

- [ ] **Step 1: Write the failing test**

In `apps/api/test/whiteboards.test.ts`, inside the existing `describe` that fetches `GET /whiteboards/:id` (find the test that asserts `currentUserRole`), add:

```ts
it('reports the assistant switch on the board response, off by default', async () => {
  const fx = await createBoardFixture(ctx);
  const res = await ctx.inject({
    method: 'GET',
    url: `/whiteboards/${fx.boardId}`,
    headers: ctx.authHeader(fx.ownerToken),
  });
  expect(res.statusCode).toBe(200);
  expect(res.json().assistantEnabled).toBe(false);
});
```

If `createBoardFixture` is not yet imported in that file, add it to the existing `./helpers.js` import.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/mr_user/development/apps/wally-assistant/apps/api && FIRESTORE_EMULATOR_HOST=localhost:8080 FIREBASE_PROJECT_ID=luminull-wally NODE_ENV=test pnpm vitest run test/whiteboards.test.ts`
Expected: FAIL, `expected undefined to be false`.

- [ ] **Step 3: Add the switch to the environment**

In `apps/api/src/env.ts`, add to `envSchema` after `NODE_ENV`:

```ts
  // The assistant's deployment switch. Off by default: with it off, the board response
  // reports `assistantEnabled: false` and every assistant operation answers 404.
  ASSISTANT_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
```

- [ ] **Step 4: Add the field to the contract and the mapper**

In `packages/shared/src/schemas/board.ts`, add to `whiteboardDtoSchema` after `currentUserRole`:

```ts
  /** Deployment switch and, later, the per-board switch combined: what the web shows. */
  assistantEnabled: z.boolean(),
```

In `apps/api/src/lib/dto.ts`, import `loadEnv` from `'../env.js'` and add to the object returned by `toWhiteboardDto`, after `currentUserRole`:

```ts
    assistantEnabled: loadEnv().ASSISTANT_ENABLED,
```

In `apps/web/src/test/fixtures.ts`, add `assistantEnabled: false,` to the object in `makeBoard`, after `currentUserRole: 'OWNER',`.

- [ ] **Step 5: Document the variable**

Append to `apps/api/.env.example` and to the API section of `.env.example` (match the surrounding style):

```
# Assistant deployment switch. Off unless set to exactly "true".
ASSISTANT_ENABLED=false
```

- [ ] **Step 6: Run the test and the checks**

Run the test command from Step 2. Expected: PASS.
Run from the worktree root: `pnpm --filter @wally/shared typecheck && pnpm --filter @wally/api typecheck && pnpm --filter @wally/web typecheck && pnpm --filter @wally/api lint && pnpm format:check`. Expected: all pass. If `format:check` fails, run `pnpm format` and re-check.

- [ ] **Step 7: Commit**

```bash
cd /Users/mr_user/development/apps/wally-assistant && git add apps/api/src/env.ts packages/shared/src/schemas/board.ts apps/api/src/lib/dto.ts apps/web/src/test/fixtures.ts apps/api/.env.example .env.example apps/api/test/whiteboards.test.ts && git commit -m "feat(api): assistant deployment switch on the board response" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The operation registry

**Files:**

- Create: `apps/api/src/lib/assistant/operations.ts`
- Test: `apps/api/src/lib/assistant/operations.test.ts` (pure, no emulator)

**Interfaces:**

- Consumes: `noteCreateSchema`, `noteUpdateSchema`, `noteMoveSchema`, `noteAssignSchema`, `subtaskCreateSchema`, `notePrioritySchema`, `noteHorizonSchema`, `revisionSchema` from `@wally/shared`.
- Produces: `operationInputs`, `operationAnnotations`, `operationNames`, `LIST_NOTES_MAX`, types `OperationName`, `OperationInput<N>`, `OperationAnnotations`, `OperationRisk`, and `riskOf(...)`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/lib/assistant/operations.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  LIST_NOTES_MAX,
  operationAnnotations,
  operationInputs,
  operationNames,
  riskOf,
} from './operations.js';

const board = { boardId: 'board-1' };
const note = { boardId: 'board-1', noteId: 'note-1', expectedRevision: 3 };

describe('operation inputs', () => {
  it('names exactly the v1 surface', () => {
    expect([...operationNames].sort()).toEqual(
      [
        'add_subtask',
        'assign_note',
        'complete_note',
        'create_note',
        'delete_note',
        'get_note',
        'list_members',
        'list_notes',
        'move_note',
        'reopen_note',
        'toggle_subtask',
        'update_note',
      ].sort(),
    );
  });

  it('requires expectedRevision on every write to an existing note', () => {
    for (const name of [
      'update_note',
      'move_note',
      'complete_note',
      'reopen_note',
      'add_subtask',
      'toggle_subtask',
      'assign_note',
      'delete_note',
    ] as const) {
      const result = operationInputs[name].safeParse({ boardId: 'board-1', noteId: 'note-1' });
      expect(result.success, name).toBe(false);
    }
  });

  it('create_note takes no revision and accepts an empty input', () => {
    expect(operationInputs.create_note.safeParse({ ...board, input: {} }).success).toBe(true);
    expect(
      operationInputs.create_note.safeParse({ ...board, expectedRevision: 1, input: {} }).success,
    ).toBe(false);
  });

  it('update_note has no assignment field', () => {
    expect(
      operationInputs.update_note.safeParse({ ...note, input: { assigneeId: 'someone' } }).success,
    ).toBe(false);
    expect(operationInputs.update_note.safeParse({ ...note, input: { title: 'x' } }).success).toBe(
      true,
    );
  });

  it('list_notes bounds its limit and defaults it to the maximum', () => {
    expect(operationInputs.list_notes.parse(board).limit).toBe(LIST_NOTES_MAX);
    expect(operationInputs.list_notes.safeParse({ ...board, limit: 0 }).success).toBe(false);
    expect(
      operationInputs.list_notes.safeParse({ ...board, limit: LIST_NOTES_MAX + 1 }).success,
    ).toBe(false);
  });

  it('rejects unknown keys everywhere', () => {
    for (const name of operationNames) {
      const result = operationInputs[name].safeParse({ ...note, input: {}, extra: 1 });
      expect(result.success, name).toBe(false);
    }
  });
});

describe('operation annotations', () => {
  it('marks reads read-only and delete destructive', () => {
    expect(operationAnnotations.list_notes.readOnlyHint).toBe(true);
    expect(operationAnnotations.get_note.readOnlyHint).toBe(true);
    expect(operationAnnotations.list_members.readOnlyHint).toBe(true);
    expect(operationAnnotations.delete_note).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    });
    for (const name of operationNames) {
      if (name === 'delete_note') continue;
      expect(operationAnnotations[name].destructiveHint, name).toBe(false);
    }
  });
});

describe('riskOf', () => {
  const me = 'user-me';
  it('deleting is always a named confirm', () => {
    expect(riskOf('delete_note', note, me, { visibility: 'SHARED' })).toBe('DELETE');
  });
  it('assigning to someone else is a named confirm, to oneself or nobody is not', () => {
    expect(riskOf('assign_note', { ...note, input: { assigneeId: 'other' } }, me, null)).toBe(
      'ASSIGN_OTHER',
    );
    expect(riskOf('assign_note', { ...note, input: { assigneeId: me } }, me, null)).toBeNull();
    expect(riskOf('assign_note', { ...note, input: { assigneeId: null } }, me, null)).toBeNull();
    expect(riskOf('create_note', { ...board, input: { assigneeId: 'other' } }, me, null)).toBe(
      'ASSIGN_OTHER',
    );
    expect(riskOf('create_note', { ...board, input: {} }, me, null)).toBeNull();
  });
  it('making a private note shared is a named confirm', () => {
    expect(
      riskOf('update_note', { ...note, input: { visibility: 'SHARED' } }, me, {
        visibility: 'PRIVATE',
      }),
    ).toBe('MAKE_SHARED');
    expect(
      riskOf('update_note', { ...note, input: { visibility: 'SHARED' } }, me, {
        visibility: 'SHARED',
      }),
    ).toBeNull();
    expect(riskOf('update_note', { ...note, input: { title: 'x' } }, me, null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/mr_user/development/apps/wally-assistant/apps/api && pnpm vitest run src/lib/assistant/operations.test.ts`
Expected: FAIL, cannot find module `./operations.js`.

- [ ] **Step 3: Write the registry**

Create `apps/api/src/lib/assistant/operations.ts`:

```ts
import { z } from 'zod';
import {
  noteAssignSchema,
  noteCreateSchema,
  noteHorizonSchema,
  noteMoveSchema,
  notePrioritySchema,
  noteUpdateSchema,
  revisionSchema,
  subtaskCreateSchema,
  type NoteVisibility,
} from '@wally/shared';

/**
 * The whole v1 operation surface of the assistant (0003-wally-agent.md §3.3). Each operation is
 * a thin adapter over one query or one command of the board operations contract; adding
 * one is a product decision. The annotations are MCP's behaviour hints, carried here so
 * the MCP proposal needs no second definition.
 */

/** Rows a single `list_notes` call may return; it reports `truncated` beyond that. */
export const LIST_NOTES_MAX = 100;

const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[^/]+$/);
const boardRef = { boardId: id };
const noteRef = { boardId: id, noteId: id, expectedRevision: revisionSchema };

export const operationInputs = {
  list_notes: z
    .object({
      ...boardRef,
      q: z.string().trim().max(200).optional(),
      status: z.enum(['OPEN', 'DONE', 'ALL']).default('ALL'),
      priority: z.array(notePrioritySchema).optional(),
      horizon: z.array(noteHorizonSchema).optional(),
      assignedToMe: z.boolean().optional(),
      limit: z.number().int().min(1).max(LIST_NOTES_MAX).default(LIST_NOTES_MAX),
    })
    .strict(),
  get_note: z.object({ ...boardRef, noteId: id }).strict(),
  list_members: z.object(boardRef).strict(),
  create_note: z.object({ ...boardRef, input: noteCreateSchema.strict() }).strict(),
  // noteUpdateSchema has no assignment field by design; assign_note is the only way.
  update_note: z.object({ ...noteRef, input: noteUpdateSchema }).strict(),
  move_note: z.object({ ...noteRef, input: noteMoveSchema }).strict(),
  complete_note: z.object(noteRef).strict(),
  reopen_note: z.object(noteRef).strict(),
  add_subtask: z.object({ ...noteRef, input: subtaskCreateSchema.strict() }).strict(),
  toggle_subtask: z
    .object({ ...noteRef, subtaskId: id, input: z.object({ done: z.boolean() }).strict() })
    .strict(),
  assign_note: z.object({ ...noteRef, input: noteAssignSchema.strict() }).strict(),
  delete_note: z.object(noteRef).strict(),
} as const;

export type OperationName = keyof typeof operationInputs;
export type OperationInput<N extends OperationName> = z.infer<(typeof operationInputs)[N]>;
export const operationNames = Object.keys(operationInputs) as OperationName[];

/** MCP tool annotations: https://modelcontextprotocol.io/specification/2025-06-18/server/tools */
export interface OperationAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
}
const read: OperationAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
};
const write = (idempotentHint: boolean): OperationAnnotations => ({
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint,
});

export const operationAnnotations: Record<OperationName, OperationAnnotations> = {
  list_notes: read,
  get_note: read,
  list_members: read,
  create_note: write(false),
  update_note: write(true),
  move_note: write(true),
  complete_note: write(true),
  reopen_note: write(true),
  add_subtask: write(false),
  toggle_subtask: write(false),
  assign_note: write(false),
  delete_note: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
};

/** The risky cases that need a second, named confirm (0003-wally-agent.md §3.2). */
export type OperationRisk = 'DELETE' | 'ASSIGN_OTHER' | 'MAKE_SHARED';

export function riskOf<N extends OperationName>(
  name: N,
  input: OperationInput<N>,
  actorId: string,
  target: Pick<{ visibility: NoteVisibility }, 'visibility'> | null,
): OperationRisk | null {
  if (name === 'delete_note') return 'DELETE';
  if (name === 'create_note' || name === 'assign_note') {
    const assigneeId = (input as OperationInput<'create_note' | 'assign_note'>).input.assigneeId;
    if (assigneeId && assigneeId !== actorId) return 'ASSIGN_OTHER';
  }
  if (name === 'update_note') {
    const visibility = (input as OperationInput<'update_note'>).input.visibility;
    if (visibility === 'SHARED' && target?.visibility === 'PRIVATE') return 'MAKE_SHARED';
  }
  return null;
}
```

If `NoteVisibility` is not exported under that name from `@wally/shared`, use the type that `noteVisibilitySchema` infers (`z.infer<typeof noteVisibilitySchema>`) and say so in your report.

- [ ] **Step 4: Run the tests to verify they pass**

Run the command from Step 2. Expected: PASS, all tests.

- [ ] **Step 5: Checks and commit**

Run from the worktree root: `pnpm --filter @wally/api typecheck && pnpm --filter @wally/api lint && pnpm format:check` (run `pnpm format` first if needed). Expected: pass.

```bash
cd /Users/mr_user/development/apps/wally-assistant && git add apps/api/src/lib/assistant/operations.ts apps/api/src/lib/assistant/operations.test.ts && git commit -m "feat(api): assistant operation registry with input schemas and annotations" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Provenance on receipts and history, and the audit record

**Files:**

- Create: `apps/api/src/lib/assistant/provenance.ts`
- Modify: `apps/api/src/lib/db/types.ts` (add `AssistantAuditDoc`)
- Modify: `apps/api/src/lib/db/collections.ts` (add `assistantAuditCol`)
- Modify: `apps/api/src/lib/commands/context.ts` (`CommandContext.provenance`)
- Modify: `apps/api/src/lib/commands/index.ts` (`executeBoardCommand` options, fingerprint, receipt, audit, log line)
- Modify: `apps/api/src/lib/commands/notes.ts` (history metadata for `CREATED` and `MOVED`)
- Modify: `docs/architecture/board-operations.md` (new section)
- Test: `apps/api/test/assistant-provenance.test.ts`

**Interfaces:**

- Consumes: `executeBoardCommand(db, actor, command, metadata, options)` as it exists.
- Produces:

```ts
// apps/api/src/lib/assistant/provenance.ts
export interface Provenance {
  via: 'assistant';
  conversationId: string;
  approvalId: string;
}
export const ASSISTANT_AUDIT_RETENTION_DAYS = 30;
```

`executeBoardCommand` options gain `provenance?: Provenance`. `CommandContext` gains `provenance?: Provenance`.

```ts
// apps/api/src/lib/db/types.ts
export interface AssistantAuditDoc {
  operationId: string;
  actorId: string;
  boardId: string;
  /** The note the command targeted, or the note it created; null for board commands. */
  targetId: string | null;
  commandType: BoardCommand['type'];
  conversationId: string;
  approvalId: string;
  revision: number;
  occurredAt: Timestamp;
  expiresAt: Timestamp;
}
```

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/assistant-provenance.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { executeBoardCommand, type Actor } from '../src/lib/commands/index.js';
import { assistantAuditCol, docsWithId, historyCol } from '../src/lib/db/collections.js';
import {
  ASSISTANT_AUDIT_RETENTION_DAYS,
  type Provenance,
} from '../src/lib/assistant/provenance.js';
import { AppError } from '../src/lib/errors.js';
import { buildTestApp, createBoardFixture, resetDatabase, type TestContext } from './helpers.js';

const PROJECT_ID = 'wally-test-assistant-provenance';
const provenance: Provenance = { via: 'assistant', conversationId: 'conv-1', approvalId: 'appr-1' };

describe('assistant provenance on the command layer', () => {
  let ctx: TestContext;
  let boardId: string;
  let owner: Actor;

  beforeAll(async () => {
    ctx = await buildTestApp(PROJECT_ID);
  });
  afterEach(async () => {
    await resetDatabase(PROJECT_ID);
  });
  afterAll(async () => {
    await resetDatabase(PROJECT_ID);
    await ctx.app.close();
  });

  async function fixture() {
    const fx = await createBoardFixture(ctx);
    boardId = fx.boardId;
    owner = { id: fx.ownerId, email: 'owner@fixture.de', emailVerified: true };
  }
  const receiptOf = (operationId: string) =>
    ctx.db.collection('users').doc(owner.id).collection('boardOperations').doc(operationId).get();
  const create = (operationId: string, p: Provenance | undefined, title = 'Müller anrufen') =>
    executeBoardCommand(
      ctx.db,
      owner,
      { type: 'note.create', boardId, input: { title } },
      { operationId },
      { provenance: p },
    );

  it('stores provenance on the receipt, writes one audit record and marks the history event', async () => {
    await fixture();
    const operationId = randomUUID();
    const result = await create(operationId, provenance);
    const noteId = (result.data as { id: string }).id;

    expect((await receiptOf(operationId)).data()?.provenance).toEqual(provenance);

    const audit = (await assistantAuditCol(ctx.db).doc(operationId).get()).data();
    expect(audit).toMatchObject({
      operationId,
      actorId: owner.id,
      boardId,
      targetId: noteId,
      commandType: 'note.create',
      conversationId: 'conv-1',
      approvalId: 'appr-1',
      revision: 1,
    });
    const retentionMs = ASSISTANT_AUDIT_RETENTION_DAYS * 86400000;
    expect(audit!.expiresAt.toMillis() - audit!.occurredAt.toMillis()).toBeGreaterThan(
      retentionMs - 60000,
    );
    expect(audit!.expiresAt.toMillis() - audit!.occurredAt.toMillis()).toBeLessThan(
      retentionMs + 60000,
    );
    expect(audit).not.toHaveProperty('title');

    const history = docsWithId(await historyCol(ctx.db, noteId).get());
    expect(history).toHaveLength(1);
    expect(history[0]!.metadata).toEqual({ via: 'assistant' });
  });

  it('a replay returns the stored result and writes no second audit record', async () => {
    await fixture();
    const operationId = randomUUID();
    const first = await create(operationId, provenance);
    const second = await create(operationId, provenance);
    expect(second.data).toEqual(first.data);
    expect((await assistantAuditCol(ctx.db).get()).size).toBe(1);
  });

  it('the same operation id with a different provenance is a key reuse', async () => {
    await fixture();
    const operationId = randomUUID();
    await create(operationId, provenance);
    await expect(
      create(operationId, { ...provenance, approvalId: 'appr-2' }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'IDEMPOTENCY_KEY_REUSED',
    } satisfies Partial<AppError>);
    expect((await assistantAuditCol(ctx.db).get()).size).toBe(1);
  });

  it('a command without provenance leaves receipt, history and audit untouched', async () => {
    await fixture();
    const operationId = randomUUID();
    const result = await create(operationId, undefined);
    const noteId = (result.data as { id: string }).id;
    expect((await receiptOf(operationId)).data()).not.toHaveProperty('provenance');
    expect((await assistantAuditCol(ctx.db).get()).size).toBe(0);
    const history = docsWithId(await historyCol(ctx.db, noteId).get());
    expect(history[0]!.metadata).toBeNull();
  });

  it('a move keeps its own metadata and adds via', async () => {
    await fixture();
    const created = await create(randomUUID(), provenance);
    const noteId = (created.data as { id: string }).id;
    await executeBoardCommand(
      ctx.db,
      owner,
      { type: 'note.move', noteId, boardId, input: { mode: 'HORIZON', horizon: 'SPAETER' } },
      { operationId: randomUUID(), expectedRevision: created.revision },
      { provenance },
    );
    const history = docsWithId(await historyCol(ctx.db, noteId).get());
    const moved = history.find((h) => h.type === 'MOVED');
    expect(moved?.metadata).toEqual({
      mode: 'HORIZON',
      from: 'HEUTE',
      to: 'SPAETER',
      via: 'assistant',
    });
    const audits = docsWithId(await assistantAuditCol(ctx.db).get());
    expect(audits.map((a) => a.commandType).sort()).toEqual(['note.create', 'note.move']);
    expect(audits.find((a) => a.commandType === 'note.move')?.targetId).toBe(noteId);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/mr_user/development/apps/wally-assistant/apps/api && FIRESTORE_EMULATOR_HOST=localhost:8080 FIREBASE_PROJECT_ID=luminull-wally NODE_ENV=test pnpm vitest run test/assistant-provenance.test.ts`
Expected: FAIL, cannot find module `../src/lib/assistant/provenance.js`.

- [ ] **Step 3: The provenance type and the audit collection**

Create `apps/api/src/lib/assistant/provenance.ts`:

```ts
/**
 * Trusted execution context for a write the assistant made. The server supplies it; it is
 * never read from a model-controlled argument (0003-wally-agent.md §3.3). The command layer
 * stores it on the receipt, folds it into the idempotency fingerprint, marks note history
 * with `via`, and writes one contents-free audit record per committed command.
 */
export interface Provenance {
  via: 'assistant';
  conversationId: string;
  approvalId: string;
}

/** Audit records expire through a Firestore TTL policy on `expiresAt`, like receipts. */
export const ASSISTANT_AUDIT_RETENTION_DAYS = 30;
```

In `apps/api/src/lib/db/types.ts`, add the `AssistantAuditDoc` interface from the Interfaces block above (import `BoardCommand` from `@wally/shared` if the file does not already).

In `apps/api/src/lib/db/collections.ts`, add next to `shareLinksCol`, following the file's existing pattern for typed collections:

```ts
/** One contents-free record per command the assistant committed; the id is the operation id. */
export const assistantAuditCol = (db: Firestore): CollectionReference<AssistantAuditDoc> =>
  db.collection('assistantAudit') as CollectionReference<AssistantAuditDoc>;
```

(Match exactly how the file casts or converts the other collections; if it uses `withConverter`, do the same.)

- [ ] **Step 4: Thread provenance through the command layer**

In `apps/api/src/lib/commands/context.ts`, import `Provenance` and add to `CommandContext`:

```ts
  /** Present when the assistant is the caller; absent for the browser. */
  provenance?: Provenance;
```

In `apps/api/src/lib/commands/index.ts`:

1. Import `assistantAuditCol` from `'../db/collections.js'` and `ASSISTANT_AUDIT_RETENTION_DAYS, type Provenance` from `'../assistant/provenance.js'`.
2. Change the options type of `executeBoardCommand` to `{ baseUrl?: string; logger?: CommandLogger; provenance?: Provenance }`.
3. Fingerprint: provenance is part of the fingerprint only when present, so receipts written before this change still replay:

```ts
const { provenance } = options;
const fingerprint = createHash('sha256')
  .update(
    canonical(
      provenance ? { command, expectedRevision, provenance } : { command, expectedRevision },
    ),
  )
  .digest('hex');
```

4. In `writeReceipt`, add the provenance to the receipt document and write the audit record in the same transaction. The helper needs the command's target, so give it the signature `(boardId, result, roles)` as today and read `command` from the enclosing scope:

```ts
const writeReceipt = (boardId: string, result: CommandResult, roles: EffectiveRole[]) => {
  tx.create(receiptRef, {
    fingerprint,
    boardId,
    roles,
    result,
    ...(provenance ? { provenance } : {}),
    createdAt: Timestamp.now(),
    expiresAt: Timestamp.fromMillis(Date.now() + 7 * 86400000),
  });
  if (provenance) {
    const occurredAt = Timestamp.now();
    tx.create(assistantAuditCol(db).doc(operationId), {
      operationId,
      actorId: actor.id,
      boardId,
      targetId:
        'noteId' in command
          ? command.noteId
          : ((result.data as { id?: string } | null)?.id ?? null),
      commandType: command.type,
      conversationId: provenance.conversationId,
      approvalId: provenance.approvalId,
      revision: result.revision,
      occurredAt,
      expiresAt: Timestamp.fromMillis(
        occurredAt.toMillis() + ASSISTANT_AUDIT_RETENTION_DAYS * 86400000,
      ),
    });
  }
};
```

5. Add `provenance` to the `context` object passed to `executeNoteCommand` / `executeAdminCommand`.
6. In the success log line, add `...(provenance ? { via: provenance.via } : {})`.

In `apps/api/src/lib/commands/notes.ts`, mark history. Near the top of `executeNoteCommand`, after `const timestamp = now();`:

```ts
const via = ctx.provenance ? { via: ctx.provenance.via } : {};
```

For the `CREATED` event, replace `metadata: source ? { duplicatedFrom: source.id } : null,` with:

```ts
      metadata:
        source || ctx.provenance ? { ...(source ? { duplicatedFrom: source.id } : {}), ...via } : null,
```

For the `MOVED` event, spread `...via` into the metadata object it writes (keep the existing move metadata).

- [ ] **Step 5: Run the tests to verify they pass**

Run the command from Step 2. Expected: PASS, 5 tests. Then run the existing suites that touch receipts and history to confirm nothing regressed, one file at a time: `test/notes.test.ts`, `test/board-safety.test.ts`, `test/private-notes.test.ts`. Expected: PASS.

- [ ] **Step 6: Document the contract**

In `docs/architecture/board-operations.md`, add a section at the end:

```markdown
## Provenance and the assistant audit record

A caller acting for the assistant passes `provenance` (`via`, `conversationId`,
`approvalId`) in the options of `executeBoardCommand`. It is trusted execution context,
never a command argument. The command layer:

- stores it on the receipt and includes it in the idempotency fingerprint, so a replay of
  the same operation id from a different approval is refused with `409 IDEMPOTENCY_KEY_REUSED`;
- adds `via` to the metadata of the `CREATED` and `MOVED` history events it writes;
- writes one document to the top-level `assistantAudit` collection, keyed by the operation
  id, in the same transaction as the change: actor, board, target note, command type,
  conversation and approval ids, committed revision, timestamp, and `expiresAt` 30 days
  later for a Firestore TTL policy. It holds no note content. A replay writes no second record.

Receipts keep their seven-day TTL independently.
```

- [ ] **Step 7: Checks and commit**

Run from the worktree root: `pnpm --filter @wally/api typecheck && pnpm --filter @wally/api lint && pnpm format:check` (run `pnpm format` first if needed). Expected: pass.

```bash
cd /Users/mr_user/development/apps/wally-assistant && git add apps/api/src/lib/assistant/provenance.ts apps/api/src/lib/db/types.ts apps/api/src/lib/db/collections.ts apps/api/src/lib/commands/context.ts apps/api/src/lib/commands/index.ts apps/api/src/lib/commands/notes.ts apps/api/test/assistant-provenance.test.ts docs/architecture/board-operations.md && git commit -m "feat(api): assistant provenance on receipts and history, with an audit record" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The operation runner

**Files:**

- Create: `apps/api/src/lib/assistant/run.ts`
- Test: `apps/api/test/assistant-operations.test.ts`

**Interfaces:**

- Consumes: `operationInputs`, `operationAnnotations`, `OperationName`, `OperationInput` (Task 2); `Provenance` (Task 3); `executeBoardCommand`, `listNotes`, `getNote`, `listMembers`.
- Produces:

```ts
export interface OperationContext {
  db: Firestore;
  actor: Actor;
  /** The board the conversation is bound to; every call must name it. */
  boardId: string;
  /** The effective switch, deployment and (later) board combined. */
  assistantEnabled: boolean;
  provenance: Provenance;
  logger?: CommandLogger;
}
export interface OperationCall {
  name: string;
  input: unknown;
  /** Allocated by the caller (the approval record later); one per write, reused on retry. */
  operationId: string;
}
export interface OperationResult {
  data: unknown;
  /** The committed revision of a write, the note's revision for get_note, null otherwise. */
  revision: number | null;
}
export interface NoteRow { ... }  // see Step 3
export async function runOperation(ctx: OperationContext, call: OperationCall): Promise<OperationResult>;
```

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/assistant-operations.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '../src/lib/commands/index.js';
import { runOperation, type OperationContext } from '../src/lib/assistant/run.js';
import type { Provenance } from '../src/lib/assistant/provenance.js';
import { assistantAuditCol } from '../src/lib/db/collections.js';
import {
  buildTestApp,
  createBoardFixture,
  createTestBoard,
  registerTestUser,
  resetDatabase,
  type TestContext,
} from './helpers.js';

const PROJECT_ID = 'wally-test-assistant-operations';
const provenance: Provenance = { via: 'assistant', conversationId: 'conv-1', approvalId: 'appr-1' };

describe('runOperation', () => {
  let ctx: TestContext;
  let boardId: string;
  let owner: Actor;
  let viewer: Actor;

  beforeAll(async () => {
    ctx = await buildTestApp(PROJECT_ID);
  });
  afterEach(async () => {
    await resetDatabase(PROJECT_ID);
  });
  afterAll(async () => {
    await resetDatabase(PROJECT_ID);
    await ctx.app.close();
  });

  async function fixture() {
    const fx = await createBoardFixture(ctx);
    boardId = fx.boardId;
    owner = { id: fx.ownerId, email: 'owner@fixture.de', emailVerified: true };
    viewer = { id: fx.viewerId, email: 'viewer@fixture.de', emailVerified: true };
  }
  const as = (actor: Actor, overrides: Partial<OperationContext> = {}): OperationContext => ({
    db: ctx.db,
    actor,
    boardId,
    assistantEnabled: true,
    provenance,
    ...overrides,
  });
  const call = (name: string, input: unknown) => ({ name, input, operationId: randomUUID() });
  const create = (actor: Actor, input: Record<string, unknown>) =>
    runOperation(as(actor), call('create_note', { boardId, input }));
  const idOf = (result: { data: unknown }) => (result.data as { id: string }).id;

  it('creates, lists and reads a note', async () => {
    await fixture();
    const created = await create(owner, { title: 'Müller anrufen', priority: 'HOCH' });
    expect(created.revision).toBe(1);
    const noteId = idOf(created);

    const list = await runOperation(as(owner), call('list_notes', { boardId }));
    expect(list.data).toMatchObject({ truncated: false, total: 1 });
    const rows = (list.data as { notes: { id: string; title: string; revision: number }[] }).notes;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: noteId,
      title: 'Müller anrufen',
      revision: 1,
      priority: 'HOCH',
    });
    expect(rows[0]).not.toHaveProperty('description');

    const detail = await runOperation(as(owner), call('get_note', { boardId, noteId }));
    expect(detail.revision).toBe(1);
    expect(detail.data).toMatchObject({ id: noteId, title: 'Müller anrufen', subtasks: [] });
    expect(detail.data).not.toHaveProperty('history');
  });

  it('bounds list_notes and reports truncation', async () => {
    await fixture();
    for (const title of ['a', 'b', 'c']) await create(owner, { title });
    const exact = await runOperation(as(owner), call('list_notes', { boardId, limit: 3 }));
    expect(exact.data).toMatchObject({ truncated: false, total: 3 });
    const cut = await runOperation(as(owner), call('list_notes', { boardId, limit: 2 }));
    expect(cut.data).toMatchObject({ truncated: true, total: 3 });
    expect((cut.data as { notes: unknown[] }).notes).toHaveLength(2);
  });

  it('passes filters through to the query', async () => {
    await fixture();
    await create(owner, { title: 'hoch', priority: 'HOCH' });
    await create(owner, { title: 'niedrig', priority: 'NIEDRIG' });
    const list = await runOperation(
      as(owner),
      call('list_notes', { boardId, priority: ['HOCH'], q: 'ho' }),
    );
    expect((list.data as { notes: { title: string }[] }).notes.map((n) => n.title)).toEqual([
      'hoch',
    ]);
  });

  it('lists members', async () => {
    await fixture();
    const members = await runOperation(as(owner), call('list_members', { boardId }));
    const rows = members.data as { userId: string | null; role: string }[];
    expect(rows.map((m) => m.role).sort()).toEqual(['EDIT', 'OWNER', 'VIEW']);
  });

  it('runs every write through the command layer with the given revision', async () => {
    await fixture();
    const noteId = idOf(await create(owner, { title: 'x' }));
    const upd = await runOperation(
      as(owner),
      call('update_note', { boardId, noteId, expectedRevision: 1, input: { title: 'y' } }),
    );
    expect(upd.revision).toBe(2);
    const moved = await runOperation(
      as(owner),
      call('move_note', {
        boardId,
        noteId,
        expectedRevision: 2,
        input: { mode: 'HORIZON', horizon: 'SPAETER' },
      }),
    );
    expect(moved.revision).toBe(3);
    const sub = await runOperation(
      as(owner),
      call('add_subtask', { boardId, noteId, expectedRevision: 3, input: { text: 'Teil 1' } }),
    );
    const subtaskId = idOf(sub);
    const toggled = await runOperation(
      as(owner),
      call('toggle_subtask', {
        boardId,
        noteId,
        subtaskId,
        expectedRevision: sub.revision,
        input: { done: true },
      }),
    );
    const detail = await runOperation(as(owner), call('get_note', { boardId, noteId }));
    expect(detail.data).toMatchObject({ subtaskSummary: { total: 1, done: 1 } });
    const done = await runOperation(
      as(owner),
      call('complete_note', { boardId, noteId, expectedRevision: toggled.revision }),
    );
    expect(done.data).toMatchObject({ status: 'DONE' });
    const open = await runOperation(
      as(owner),
      call('reopen_note', { boardId, noteId, expectedRevision: done.revision }),
    );
    expect(open.data).toMatchObject({ status: 'OPEN' });
    const assigned = await runOperation(
      as(owner),
      call('assign_note', {
        boardId,
        noteId,
        expectedRevision: open.revision,
        input: { assigneeId: owner.id },
      }),
    );
    expect(assigned.data).toMatchObject({ assignee: { id: owner.id } });
    await runOperation(
      as(owner),
      call('delete_note', { boardId, noteId, expectedRevision: assigned.revision }),
    );
    await expect(
      runOperation(as(owner), call('get_note', { boardId, noteId })),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect((await assistantAuditCol(ctx.db).get()).size).toBe(9);
  });

  it('refuses a stale revision without applying anything', async () => {
    await fixture();
    const noteId = idOf(await create(owner, { title: 'x' }));
    await expect(
      runOperation(
        as(owner),
        call('update_note', { boardId, noteId, expectedRevision: 0, input: { title: 'y' } }),
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: 'STALE_REVISION' });
    const detail = await runOperation(as(owner), call('get_note', { boardId, noteId }));
    expect(detail.data).toMatchObject({ title: 'x', revision: 1 });
  });

  it('binds every call to the context board', async () => {
    await fixture();
    registerTestUser(ctx, 'other-owner', 'other@fixture.de', 'Other');
    const otherBoard = await createTestBoard(ctx.db, 'other-owner');
    const other: Actor = { id: 'other-owner', email: 'other@fixture.de', emailVerified: true };
    const foreign = idOf(
      await runOperation(
        as(other, { boardId: otherBoard }),
        call('create_note', { boardId: otherBoard, input: { title: 'theirs' } }),
      ),
    );

    await expect(
      runOperation(as(owner), call('get_note', { boardId, noteId: foreign })),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      runOperation(
        as(owner),
        call('complete_note', { boardId, noteId: foreign, expectedRevision: 1 }),
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      runOperation(as(owner), call('list_notes', { boardId: otherBoard })),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('answers 404 for everything when the switch is off', async () => {
    await fixture();
    await expect(
      runOperation(as(owner, { assistantEnabled: false }), call('list_notes', { boardId })),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      runOperation(
        as(owner, { assistantEnabled: false }),
        call('create_note', { boardId, input: { title: 'x' } }),
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect((await assistantAuditCol(ctx.db).get()).size).toBe(0);
  });

  it('lets the command layer decide roles: a viewer keeps private notes, nothing else', async () => {
    await fixture();
    await expect(create(viewer, { title: 'shared' })).rejects.toMatchObject({ statusCode: 403 });
    const mine = await create(viewer, { title: 'mine', visibility: 'PRIVATE' });
    expect(mine.data).toMatchObject({ visibility: 'PRIVATE' });
    const updated = await runOperation(
      as(viewer),
      call('update_note', {
        boardId,
        noteId: idOf(mine),
        expectedRevision: 1,
        input: { title: 'still mine' },
      }),
    );
    expect(updated.revision).toBe(2);
    const list = await runOperation(as(viewer), call('list_notes', { boardId }));
    expect(list.data).toMatchObject({ total: 1 });
  });

  it('rejects unknown operations and invalid input before touching the board', async () => {
    await fixture();
    await expect(runOperation(as(owner), call('drop_board', { boardId }))).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(
      runOperation(as(owner), call('update_note', { boardId, noteId: 'n', input: { title: 'y' } })),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      runOperation(
        as(owner),
        call('create_note', { boardId, input: { title: 'x' }, approvalId: 'spoof' }),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('reuses the operation id on retry', async () => {
    await fixture();
    const op = call('create_note', { boardId, input: { title: 'once' } });
    const first = await runOperation(as(owner), op);
    const second = await runOperation(as(owner), op);
    expect(second.data).toEqual(first.data);
    const list = await runOperation(as(owner), call('list_notes', { boardId }));
    expect(list.data).toMatchObject({ total: 1 });
  });
});
```

Format the file with Prettier before running; the long lines above are written for reading, not for the linter.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/mr_user/development/apps/wally-assistant/apps/api && FIRESTORE_EMULATOR_HOST=localhost:8080 FIREBASE_PROJECT_ID=luminull-wally NODE_ENV=test pnpm vitest run test/assistant-operations.test.ts`
Expected: FAIL, cannot find module `../src/lib/assistant/run.js`.

- [ ] **Step 3: Write the runner**

Create `apps/api/src/lib/assistant/run.ts`:

```ts
import type { Firestore } from 'firebase-admin/firestore';
import type { BoardCommand, NoteDetailDto, NoteDto } from '@wally/shared';
import { executeBoardCommand, type Actor, type CommandLogger } from '../commands/index.js';
import { getNote, listMembers, listNotes } from '../commands/queries.js';
import { AppError } from '../errors.js';
import {
  operationAnnotations,
  operationInputs,
  type OperationInput,
  type OperationName,
} from './operations.js';
import type { Provenance } from './provenance.js';

export interface OperationContext {
  db: Firestore;
  actor: Actor;
  /** The board the conversation is bound to; every call must name it. */
  boardId: string;
  /** The effective switch, deployment and (later) board combined. */
  assistantEnabled: boolean;
  provenance: Provenance;
  logger?: CommandLogger;
}
export interface OperationCall {
  name: string;
  input: unknown;
  /** Allocated by the caller, one per write, reused on retry so the receipt replays. */
  operationId: string;
}
export interface OperationResult {
  data: unknown;
  /** The committed revision of a write, the note's revision for get_note, null otherwise. */
  revision: number | null;
}
/** A compact row for the model: what a question needs, not the whole note. */
export interface NoteRow {
  id: string;
  title: string;
  status: NoteDto['status'];
  priority: NoteDto['priority'];
  horizon: NoteDto['horizon'];
  dueDate: string | null;
  visibility: NoteDto['visibility'];
  assignee: NoteDto['assignee'];
  subtaskSummary: NoteDto['subtaskSummary'];
  revision: number;
}

const notFound = () => new AppError(404, 'NOT_FOUND', 'Not found');

/**
 * Runs one assistant operation for one caller on one board. Reads go to the query
 * functions; writes go through executeBoardCommand with the caller as actor, the call's
 * operation id and expected revision, and the server's provenance. Nothing here touches
 * Firestore directly.
 */
export async function runOperation(
  ctx: OperationContext,
  call: OperationCall,
): Promise<OperationResult> {
  if (!ctx.assistantEnabled) throw notFound();
  if (!Object.hasOwn(operationInputs, call.name))
    throw new AppError(400, 'BAD_REQUEST', 'Unknown operation');
  const name = call.name as OperationName;
  const parsed = operationInputs[name].safeParse(call.input);
  if (!parsed.success) throw new AppError(400, 'BAD_REQUEST', 'Invalid operation input');
  // Board context is explicit: the call names the board, and it must be the bound one.
  if (parsed.data.boardId !== ctx.boardId) throw notFound();

  if (operationAnnotations[name].readOnlyHint) return read(ctx, name, parsed.data);

  const { command, expectedRevision } = toCommand(name, parsed.data);
  const result = await executeBoardCommand(
    ctx.db,
    ctx.actor,
    command,
    { operationId: call.operationId, expectedRevision },
    { logger: ctx.logger, provenance: ctx.provenance },
  );
  return { data: result.data, revision: result.revision };
}

async function read(
  ctx: OperationContext,
  name: OperationName,
  input: OperationInput<OperationName>,
): Promise<OperationResult> {
  const { db, actor, boardId } = ctx;
  switch (name) {
    case 'list_notes': {
      const { q, status, priority, horizon, assignedToMe, limit } =
        input as OperationInput<'list_notes'>;
      const notes = await listNotes(db, actor, boardId, {
        ...(q !== undefined ? { q } : {}),
        status,
        ...(priority ? { priority: priority.join(',') } : {}),
        ...(horizon ? { horizon: horizon.join(',') } : {}),
        ...(assignedToMe ? { assignedToMe: 'true' } : {}),
      });
      return {
        data: {
          notes: notes.slice(0, limit).map(toRow),
          truncated: notes.length > limit,
          total: notes.length,
        },
        revision: null,
      };
    }
    case 'get_note': {
      const { noteId } = input as OperationInput<'get_note'>;
      const { history: _history, ...note } = await getNote(db, actor, noteId, boardId);
      return { data: note satisfies Omit<NoteDetailDto, 'history'>, revision: note.revision };
    }
    case 'list_members': {
      const members = await listMembers(db, actor, boardId);
      return { data: members.data, revision: members.revision };
    }
    default:
      throw new AppError(400, 'BAD_REQUEST', 'Unknown operation');
  }
}

function toRow(note: NoteDto): NoteRow {
  return {
    id: note.id,
    title: note.title,
    status: note.status,
    priority: note.priority,
    horizon: note.horizon,
    dueDate: note.dueDate,
    visibility: note.visibility,
    assignee: note.assignee,
    subtaskSummary: note.subtaskSummary,
    revision: note.revision,
  };
}

function toCommand(
  name: OperationName,
  input: OperationInput<OperationName>,
): { command: BoardCommand; expectedRevision?: number } {
  switch (name) {
    case 'create_note': {
      const { boardId, input: body } = input as OperationInput<'create_note'>;
      return { command: { type: 'note.create', boardId, input: body } };
    }
    case 'update_note': {
      const {
        boardId,
        noteId,
        expectedRevision,
        input: body,
      } = input as OperationInput<'update_note'>;
      return { command: { type: 'note.update', noteId, boardId, input: body }, expectedRevision };
    }
    case 'move_note': {
      const {
        boardId,
        noteId,
        expectedRevision,
        input: body,
      } = input as OperationInput<'move_note'>;
      return { command: { type: 'note.move', noteId, boardId, input: body }, expectedRevision };
    }
    case 'complete_note':
    case 'reopen_note': {
      const { boardId, noteId, expectedRevision } = input as OperationInput<'complete_note'>;
      const type = name === 'complete_note' ? 'note.complete' : 'note.reopen';
      return { command: { type, noteId, boardId, input: {} }, expectedRevision };
    }
    case 'add_subtask': {
      const {
        boardId,
        noteId,
        expectedRevision,
        input: body,
      } = input as OperationInput<'add_subtask'>;
      return {
        command: { type: 'subtask.create', noteId, boardId, input: body },
        expectedRevision,
      };
    }
    case 'toggle_subtask': {
      const {
        boardId,
        noteId,
        subtaskId,
        expectedRevision,
        input: body,
      } = input as OperationInput<'toggle_subtask'>;
      return {
        command: { type: 'subtask.update', noteId, boardId, subtaskId, input: { done: body.done } },
        expectedRevision,
      };
    }
    case 'assign_note': {
      const {
        boardId,
        noteId,
        expectedRevision,
        input: body,
      } = input as OperationInput<'assign_note'>;
      return { command: { type: 'note.assign', noteId, boardId, input: body }, expectedRevision };
    }
    case 'delete_note': {
      const { boardId, noteId, expectedRevision } = input as OperationInput<'delete_note'>;
      return { command: { type: 'note.delete', noteId, boardId, input: {} }, expectedRevision };
    }
    default:
      throw new AppError(400, 'BAD_REQUEST', 'Unknown operation');
  }
}
```

Two things to verify while writing, and to state in your report: the exact query strings `noteListQuerySchema` accepts for `priority`, `horizon` and `assignedToMe` (see `csvEnum` and `booleanQueryParam` in `packages/shared/src/schemas/note.ts`), and whether `boardCommandSchema` accepts `input: {}` for `note.complete`, `note.reopen` and `note.delete` (it declares `input: empty` with a default). Adjust the literals above if the schemas say otherwise; the behaviour in the tests is what must hold.

- [ ] **Step 4: Run the tests to verify they pass**

Run the command from Step 2. Expected: PASS, 11 tests. Then run `test/assistant-provenance.test.ts` once more. Expected: PASS.

- [ ] **Step 5: Checks and commit**

Run from the worktree root: `pnpm --filter @wally/api typecheck && pnpm --filter @wally/api lint && pnpm format:check` (run `pnpm format` first if needed). Expected: pass.

```bash
cd /Users/mr_user/development/apps/wally-assistant && git add apps/api/src/lib/assistant/run.ts apps/api/test/assistant-operations.test.ts && git commit -m "feat(api): assistant operation runner over the command layer" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review

- **Spec coverage.** §3.3 operation table: Tasks 2 and 4. §3.2 "Writes are attributed": Task 3. "It can be switched off" (deployment half): Tasks 1 and 4; the per-board half and the routes are later slices. "Stale changes are refused", "Roles hold": Task 4 tests the command layer's behaviour through the runner. "Answers say when they are partial": the bounded list in Task 4; the sentence in the answer is the panel's, later. Named confirms: `riskOf` in Task 2 computes them; the second confirm is the approval layer's, later.
- **Placeholder scan.** None: every step has its code or its exact command. The two "verify while writing" notes in Task 4 name the file and the symbol to check.
- **Type consistency.** `Provenance` (Task 3) is what `OperationContext.provenance` (Task 4) carries; `executeBoardCommand`'s third option is named `provenance` in both. `OperationInput<N>` and `operationAnnotations` (Task 2) are consumed under those names in Task 4. `assistantAuditCol` (Task 3) is read in Tasks 3 and 4.
- **Review Focus.** Each of the five items names its task, and the test for it is in that task's Step 1.
