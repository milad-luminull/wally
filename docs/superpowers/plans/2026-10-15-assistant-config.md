# Assistant Configuration and Model Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the assistant configurable and switchable: the per-board switch, the model library behind a lint-enforced boundary, model configuration, one run-a-turn function proven against the library's own mock model, and a health endpoint that reports the configured model without calling it.

**Architecture:** The per-board switch is a `board.assistant` command on the existing command layer that flips `assistantDisabled` on the board document; the effective flag on the board DTO combines it with the deployment switch. The model library (`ai`, `@ai-sdk/google-vertex`, both pinned) may be imported only under `apps/api/src/lib/assistant/model/`, enforced by ESLint. That directory exposes Wally-typed `createTurnRunner`: it maps Wally tools to library tools, pauses write tools for approval, calls `onAttempt` before every model step so a ledger can reserve, settles after each step, and never retries. Nothing outside the boundary sees a library type.

**Tech Stack:** TypeScript, Fastify + firebase-admin Firestore (API), Zod contract in `packages/shared`, Vitest; `ai@7.0.141` and `@ai-sdk/google-vertex@5.0.112` (already added to `apps/api` on this branch, exact versions, per ADR-0013 accepted 2026-10-15).

**Spec:** `docs/rfcs/0003-wally-agent.md` at commit `38afd3cb` on PR milad-luminull/wally#38; read it at `/Users/mr_user/development/apps/wally-docs-rfc-agent/docs/rfcs/0003-wally-agent.md`. The library decision is `docs/adr/0013-model-library-behind-an-owned-boundary.md` in the same checkout. The previous slice (operations, provenance, audit) is on this branch's parent `feat/assistant-operations`; its plan is `docs/superpowers/plans/2026-10-15-assistant-operations.md`.

## Context

Slice one built the operations the assistant may perform and the attribution of its writes. This slice adds what §3.2 "It can be switched off" and §3.5 of the spec require before any model-facing route can exist: the board owner's switch, the configured model, and the boundary with its adapter tests (ADR-0013, Confirmation). The web toggle for the board switch waits for the panel slice, because nothing is visible without a panel. The budget ledger waits for the turn route; this slice defines the hook it plugs into (`onAttempt`) and proves the hook fires before every model call.

Facts about the installed library, read from `apps/api/node_modules/ai/dist/index.d.ts`, `apps/api/node_modules/ai/dist/test/index.d.ts` and `apps/api/node_modules/@ai-sdk/provider/dist/index.d.ts` on 2026-10-15. The implementer re-checks any of them that the typecheck disputes and records the difference in the report:

- `generateText({ model, instructions, messages, tools, toolApproval, maxRetries, maxOutputTokens, abortSignal, stopWhen, prepareStep, onStepEnd })`. `stepCountIs(n)` is exported for `stopWhen`. `tool({ description, inputSchema, execute })` builds a tool; `inputSchema` accepts a Zod schema.
- `toolApproval` is a per-tool map whose values may be `'user-approval'` or `'not-applicable'`.
- `prepareStep` receives `{ stepNumber, messages, ... }` and may return `{}`. `onStepEnd` receives a `StepResult` with `usage` and `content`.
- The result has `text`, `content`, `steps`, `usage` (`inputTokens`, `inputTokenDetails.cacheReadTokens`, `outputTokens`, `outputTokenDetails.reasoningTokens`), `finishReason` and the response messages (`responseMessages`, or `response.messages` if the former is absent).
- A pending approval is a content part `{ type: 'tool-approval-request', approvalId, toolCall: { toolCallId, toolName, input }, reason? }`. A decision goes back as a `{ role: 'tool', content: [{ type: 'tool-approval-response', approvalId, approved, reason? }] }` message.
- `MockLanguageModelV3` from `ai/test` takes `doGenerate` as a single result or an array of results consumed in order, and records calls in `doGenerateCalls`. A result is `{ content, finishReason: { unified: 'stop' | 'tool-calls' }, usage: { inputTokens: { total, noCache, cacheRead, cacheWrite }, outputTokens: { total, text, reasoning } }, warnings: [] }`; a tool call part is `{ type: 'tool-call', toolCallId, toolName, input: '<json string>' }`; a text part is `{ type: 'text', text }`.
- `createGoogleVertex({ project, location })` returns a provider; `provider(modelId)` is a language model. `createVertexAnthropic` from `@ai-sdk/google-vertex/anthropic` does the same for Claude on Vertex.

Decisions taken for this plan:

- **Board switch is stored as `assistantDisabled`**, absent by default, so every existing board stays enabled by the deployment switch alone. Only the owner may change it (the command layer's rule for non-note commands).
- **Model reference format** is `provider:model`; the providers this slice supports are `vertex` and `vertex-anthropic`. Other providers arrive with the own-key slice.
- **An unsettled lease is the caller's problem by design:** if the library throws after a step was dispatched, the ledger keeps the reservation (spec §3.2 "Accounting is conservative").
- **No `experimental_toolApprovalSecret` yet.** The approval slice owns the approval record and decides whether to add the library's signature on top.

## Global Constraints

- Work only in `/Users/mr_user/development/apps/wally-assistant`, branch `feat/assistant-config` (parent `feat/assistant-operations`). Never run git or edit files in `/Users/mr_user/development/apps/wally`: that checkout is bind-mounted into the running dev stack.
- Tests run on the host from the worktree against the live emulator, one command at a time, never two test runs concurrently, never `docker compose run`, never any `docker compose` command that touches the `firestore` service (it holds the user's real data in memory):

  ```bash
  cd /Users/mr_user/development/apps/wally-assistant/apps/api && FIRESTORE_EMULATOR_HOST=localhost:8080 FIREBASE_PROJECT_ID=luminull-wally NODE_ENV=test pnpm vitest run <file>
  ```

  Pure test files under `src/` need no environment variables. Emulator-backed files under `test/` declare their own `PROJECT_ID`.

- Checks, from the worktree root: `pnpm --filter @wally/shared typecheck`, `pnpm --filter @wally/api typecheck`, `pnpm --filter @wally/api lint`, `pnpm --filter @wally/web typecheck`, `pnpm format:check` (fix with `pnpm format`).
- No dependency beyond `ai@7.0.141` and `@ai-sdk/google-vertex@5.0.112`, already in `apps/api/package.json`. No stored-shape change beyond `assistantDisabled?: boolean` on the board document (approved 2026-10-15).
- `ai`, `ai/*` and `@ai-sdk/*` are imported only under `apps/api/src/lib/assistant/model/` (ADR-0013). No file outside that directory may import a library type, even type-only.
- The library's automatic retries are off (`maxRetries: 0`). Every model step calls `onAttempt` first; a rejected `onAttempt` means the step is not dispatched.
- Attribution and approvals are the server's; the model never supplies them (spec §3.3).
- Error conventions: `AppError` from `apps/api/src/lib/errors.ts` with the existing codes.
- Conventional Commits; small commits; never commit to `main`. Commit with `git -c core.hooksPath=/dev/null commit`. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Prettier: single quotes, trailing commas, width 100.

## Review Focus

1. A board switched off by its owner reports `assistantEnabled: false` even when the deployment switch is on, and an absent `assistantDisabled` field reads as enabled. Test in Task 1 (`switch.test.ts`).
2. `onAttempt` rejecting before the first step means zero model calls, and rejecting before the second step means exactly one. Test in Task 3.
3. A write tool is never executed on the turn that proposes it, only on the continuation that approves it; a denial never executes it. Test in Task 3.
4. A model error surfaces once with exactly one model call, never a silent retry. Test in Task 3.
5. An import of the library outside the boundary directory fails lint, and the same import inside it passes. Test in Task 2.

---

### Task 1: Per-board switch

**Files:**

- Modify: `packages/shared/src/schemas/board.ts` (add `whiteboardAssistantSchema`)
- Modify: `packages/shared/src/schemas/command.ts` (add `board.assistant` to the union)
- Modify: `apps/api/src/lib/db/types.ts` (`WhiteboardDoc.assistantDisabled`)
- Create: `apps/api/src/lib/assistant/switch.ts`
- Modify: `apps/api/src/lib/dto.ts` (`toWhiteboardDto`)
- Modify: `apps/api/src/lib/commands/administration.ts` (`executeAdminCommand`)
- Modify: `apps/api/src/routes/boards.ts` (commands table)
- Test: `apps/api/src/lib/assistant/switch.test.ts` (pure), `apps/api/test/whiteboards.test.ts`

**Interfaces:**

- Consumes: `loadEnv().ASSISTANT_ENABLED` (slice one), `executeAdminCommand`'s `updateBoard` and `result` helpers.
- Produces: `assistantEnabledFor(env, board): boolean`; command `{ type: 'board.assistant', boardId, input: { enabled: boolean } }`; route `PATCH /whiteboards/:id/assistant`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/lib/assistant/switch.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { assistantEnabledFor } from './switch.js';

describe('assistantEnabledFor', () => {
  it('is off when the deployment switch is off, whatever the board says', () => {
    expect(assistantEnabledFor({ ASSISTANT_ENABLED: false }, {})).toBe(false);
    expect(assistantEnabledFor({ ASSISTANT_ENABLED: false }, { assistantDisabled: false })).toBe(
      false,
    );
  });
  it('is on when the deployment switch is on and the board has not switched it off', () => {
    expect(assistantEnabledFor({ ASSISTANT_ENABLED: true }, {})).toBe(true);
    expect(assistantEnabledFor({ ASSISTANT_ENABLED: true }, { assistantDisabled: false })).toBe(
      true,
    );
  });
  it('is off when the board owner switched it off', () => {
    expect(assistantEnabledFor({ ASSISTANT_ENABLED: true }, { assistantDisabled: true })).toBe(
      false,
    );
  });
});
```

In `apps/api/test/whiteboards.test.ts`, add a new `describe` after `PATCH /whiteboards/:id (owner-only rename)`:

```ts
describe('PATCH /whiteboards/:id/assistant (owner-only switch)', () => {
  it('lets the owner switch the assistant off and on again, storing only the flag', async () => {
    const fx = await createBoardFixture(ctx);
    const off = await ctx.inject({
      method: 'PATCH',
      url: `/whiteboards/${fx.boardId}/assistant`,
      headers: ctx.authHeader(fx.ownerToken),
      payload: { enabled: false },
    });
    expect(off.statusCode).toBe(200);
    expect(off.json().assistantEnabled).toBe(false);
    expect((await whiteboardsCol(ctx.db).doc(fx.boardId).get()).data()?.assistantDisabled).toBe(
      true,
    );
    const revisionAfterOff = off.json().revision;

    const on = await ctx.inject({
      method: 'PATCH',
      url: `/whiteboards/${fx.boardId}/assistant`,
      headers: ctx.authHeader(fx.ownerToken),
      payload: { enabled: true },
    });
    expect(on.statusCode).toBe(200);
    expect(on.json().revision).toBe(revisionAfterOff + 1);
    expect((await whiteboardsCol(ctx.db).doc(fx.boardId).get()).data()?.assistantDisabled).toBe(
      false,
    );
  });

  it('is a no-op when the value does not change', async () => {
    const fx = await createBoardFixture(ctx);
    const before = (
      await ctx.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}`,
        headers: ctx.authHeader(fx.ownerToken),
      })
    ).json().revision;
    const res = await ctx.inject({
      method: 'PATCH',
      url: `/whiteboards/${fx.boardId}/assistant`,
      headers: ctx.authHeader(fx.ownerToken),
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().revision).toBe(before);
  });

  it('is refused for editors, viewers and outsiders', async () => {
    const fx = await createBoardFixture(ctx);
    for (const [token, status] of [
      [fx.editToken, 403],
      [fx.viewToken, 403],
      [fx.outsiderToken, 404],
    ] as const) {
      const res = await ctx.inject({
        method: 'PATCH',
        url: `/whiteboards/${fx.boardId}/assistant`,
        headers: ctx.authHeader(token),
        payload: { enabled: false },
      });
      expect(res.statusCode).toBe(status);
    }
    expect((await whiteboardsCol(ctx.db).doc(fx.boardId).get()).data()).not.toHaveProperty(
      'assistantDisabled',
    );
  });

  it('rejects a body without a boolean', async () => {
    const fx = await createBoardFixture(ctx);
    const res = await ctx.inject({
      method: 'PATCH',
      url: `/whiteboards/${fx.boardId}/assistant`,
      headers: ctx.authHeader(fx.ownerToken),
      payload: { enabled: 'no' },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

Format the test file with Prettier before running.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/mr_user/development/apps/wally-assistant/apps/api && pnpm vitest run src/lib/assistant/switch.test.ts`
Expected: FAIL, cannot find module `./switch.js`.
Run the whiteboards file with the emulator command from Global Constraints. Expected: the four new tests FAIL with 404 (no route).

- [ ] **Step 3: The contract**

In `packages/shared/src/schemas/board.ts`, add after `whiteboardCreateSchema`:

```ts
/** PATCH /whiteboards/:id/assistant — the board owner's switch for the assistant. */
export const whiteboardAssistantSchema = z.object({
  enabled: z.boolean(),
});
export type WhiteboardAssistantInput = z.infer<typeof whiteboardAssistantSchema>;
```

In `packages/shared/src/schemas/command.ts`, import `whiteboardAssistantSchema` from `'./board.js'` and add to the union, right after the `board.rename` entry:

```ts
  z
    .object({
      type: z.literal('board.assistant'),
      ...board,
      input: whiteboardAssistantSchema.strict(),
    })
    .strict(),
```

- [ ] **Step 4: The document field and the pure switch**

In `apps/api/src/lib/db/types.ts`, add to `WhiteboardDoc` after `shareLinkToken`:

```ts
  /**
   * Set by board.assistant. Absent or false means the deployment switch alone decides, so
   * every board that existed before the assistant stays enabled with it.
   */
  assistantDisabled?: boolean;
```

Create `apps/api/src/lib/assistant/switch.ts`:

```ts
import type { Env } from '../../env.js';
import type { WhiteboardDoc } from '../db/types.js';

/** The effective switch: the deployment switch and the board owner's switch combined. */
export function assistantEnabledFor(
  env: Pick<Env, 'ASSISTANT_ENABLED'>,
  board: Pick<WhiteboardDoc, 'assistantDisabled'>,
): boolean {
  return env.ASSISTANT_ENABLED && board.assistantDisabled !== true;
}
```

In `apps/api/src/lib/dto.ts`, import `assistantEnabledFor` from `'./assistant/switch.js'` and change the field in `toWhiteboardDto` to:

```ts
    assistantEnabled: assistantEnabledFor(loadEnv(), whiteboard),
```

- [ ] **Step 5: The command and the route**

In `apps/api/src/lib/commands/administration.ts`, inside `executeAdminCommand`, add after the `board.rename` branch:

```ts
if (command.type === 'board.assistant') {
  const disabled = !command.input.enabled;
  if ((board.assistantDisabled === true) === disabled)
    return result(toWhiteboardDto(board, 'OWNER'), 200, revisionOf(board));
  updateBoard({ assistantDisabled: disabled });
  return result(
    toWhiteboardDto(
      { ...board, assistantDisabled: disabled, updatedAt: timestamp, revision },
      'OWNER',
    ),
  );
}
```

In `apps/api/src/routes/boards.ts`, add to the `commands` array right after the `board.rename` entry:

```ts
    {
      method: 'PATCH',
      url: '/whiteboards/:id/assistant',
      type: 'board.assistant',
      response: whiteboardDtoSchema,
    },
```

The route's target derivation already maps `/whiteboards/:id/...` to `boardId`, and `rolesFor` already restricts non-note commands to the owner. The test helper's `inject` adds the expected board revision for `/whiteboards/:id/...` URLs.

- [ ] **Step 6: Run the tests and the checks**

Run both test commands from Step 2. Expected: PASS (3 pure, and the whiteboards file including the 4 new tests).
Run from the worktree root: `pnpm --filter @wally/shared typecheck && pnpm --filter @wally/api typecheck && pnpm --filter @wally/web typecheck && pnpm --filter @wally/api lint && pnpm format:check`. Expected: pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/mr_user/development/apps/wally-assistant && git add packages/shared/src/schemas/board.ts packages/shared/src/schemas/command.ts apps/api/src/lib/db/types.ts apps/api/src/lib/assistant/switch.ts apps/api/src/lib/assistant/switch.test.ts apps/api/src/lib/dto.ts apps/api/src/lib/commands/administration.ts apps/api/src/routes/boards.ts apps/api/test/whiteboards.test.ts && git -c core.hooksPath=/dev/null commit -m "feat(api): per-board assistant switch for the board owner" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The boundary, its lint rule, and model configuration

**Files:**

- Modify: `apps/api/eslint.config.js`
- Modify: `apps/api/src/env.ts`
- Create: `apps/api/src/lib/assistant/model/config.ts`
- Create: `apps/api/src/lib/assistant/model/types.ts`
- Modify: `apps/api/.env.example`, `.env.example`, `docs/DEPLOY.md`
- Test: `apps/api/src/lib/assistant/model/boundary.test.ts`, `apps/api/src/lib/assistant/model/config.test.ts`

**Interfaces:**

- Consumes: `ai@7.0.141`, `@ai-sdk/google-vertex@5.0.112` (installed).
- Produces: `Env.ASSISTANT_MODEL: string` (default `vertex:gemini-3.8-flash`), `Env.ASSISTANT_VERTEX_LOCATION: string` (default `europe-west1`), `Env.ASSISTANT_VERTEX_PROJECT?: string`; `ModelRef`, `parseModelRef(value): ModelRef`, `resolveLanguageModel(ref, env)` (returns the library's model; used only inside the boundary); the types file consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/lib/assistant/model/boundary.test.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/** Runs ESLint on one virtual file; the path decides whether the boundary rule applies. */
function lint(filePath: string, source: string) {
  const run = spawnSync('pnpm', ['exec', 'eslint', '--stdin', '--stdin-filename', filePath], {
    cwd: new URL('../../../../', import.meta.url),
    input: source,
    encoding: 'utf8',
  });
  return { status: run.status, output: run.stdout + run.stderr };
}

describe('the model library boundary (ADR-0013)', () => {
  const source = "import { generateText } from 'ai';\nexport const x = generateText;\n";

  it('rejects an import of the library outside src/lib/assistant/model/', () => {
    const result = lint('src/lib/assistant/run.ts', source);
    expect(result.status).toBe(1);
    expect(result.output).toContain('no-restricted-imports');
  });

  it('rejects a provider import outside the boundary too', () => {
    const result = lint(
      'src/routes/boards.ts',
      "import { createGoogleVertex } from '@ai-sdk/google-vertex';\nexport const y = createGoogleVertex;\n",
    );
    expect(result.status).toBe(1);
    expect(result.output).toContain('no-restricted-imports');
  });

  it('allows the same import inside the boundary', () => {
    const result = lint('src/lib/assistant/model/anything.ts', source);
    expect(result.status, result.output).toBe(0);
  });
}, 60000);
```

Create `apps/api/src/lib/assistant/model/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseModelRef, resolveLanguageModel } from './config.js';

const env = {
  ASSISTANT_VERTEX_LOCATION: 'europe-west1',
  ASSISTANT_VERTEX_PROJECT: 'wally-test',
  FIREBASE_PROJECT_ID: 'wally-test',
};

describe('parseModelRef', () => {
  it('splits provider and model on the first colon', () => {
    expect(parseModelRef('vertex:gemini-3.8-flash')).toEqual({
      provider: 'vertex',
      model: 'gemini-3.8-flash',
    });
    expect(parseModelRef('vertex-anthropic:claude-sonnet-5-5')).toEqual({
      provider: 'vertex-anthropic',
      model: 'claude-sonnet-5-5',
    });
  });
  it('rejects unknown providers and malformed values', () => {
    for (const bad of ['openai:gpt', 'vertex', ':gemini', 'vertex:', 'vertex:a:b']) {
      expect(() => parseModelRef(bad), bad).toThrow();
    }
  });
});

describe('resolveLanguageModel', () => {
  it('builds a Vertex model with the configured id without calling anything', () => {
    const model = resolveLanguageModel({ provider: 'vertex', model: 'gemini-3.8-flash' }, env);
    expect(model.modelId).toBe('gemini-3.8-flash');
    expect(model.provider).toContain('vertex');
  });
  it('builds a Claude-on-Vertex model', () => {
    const model = resolveLanguageModel(
      { provider: 'vertex-anthropic', model: 'claude-sonnet-5-5' },
      env,
    );
    expect(model.modelId).toBe('claude-sonnet-5-5');
    expect(model.provider).toContain('vertex');
  });
  it('falls back to the Firebase project id', () => {
    const model = resolveLanguageModel(
      { provider: 'vertex', model: 'gemini-3.8-flash' },
      { ...env, ASSISTANT_VERTEX_PROJECT: undefined },
    );
    expect(model.modelId).toBe('gemini-3.8-flash');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/mr_user/development/apps/wally-assistant/apps/api && pnpm vitest run src/lib/assistant/model/boundary.test.ts src/lib/assistant/model/config.test.ts`
Expected: FAIL. The boundary test's first two cases fail because lint currently exits 0 (no rule); the config test fails with cannot find module `./config.js`.

- [ ] **Step 3: The lint rule**

Replace `apps/api/eslint.config.js` with:

```js
// @ts-check
import { base } from '@wally/config/eslint';

/** The model library and its providers (ADR-0013). */
const MODEL_LIBRARY = ['ai', 'ai/*', '@ai-sdk/*'];

export default [
  ...base,
  {
    ignores: ['prisma/generated/**'],
  },
  {
    // The library is imported only inside the boundary directory, so leaving it means
    // rewriting that directory and nothing else.
    files: ['src/**/*.ts', 'test/**/*.ts'],
    ignores: ['src/lib/assistant/model/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: MODEL_LIBRARY,
              message:
                'The model library is imported only under src/lib/assistant/model/ (ADR-0013).',
            },
          ],
        },
      ],
    },
  },
];
```

- [ ] **Step 4: Environment and configuration**

In `apps/api/src/env.ts`, add to `envSchema` after `ASSISTANT_ENABLED`:

```ts
  // The deployment's model as `provider:model`; parsed by lib/assistant/model/config.ts.
  // Providers in this slice: `vertex` (Gemini on Vertex) and `vertex-anthropic`.
  ASSISTANT_MODEL: z.string().min(3).default('vertex:gemini-3.8-flash'),
  // Vertex region and project for the deployment route. The project falls back to
  // FIREBASE_PROJECT_ID. The Cloud Run service account needs roles/aiplatform.user.
  ASSISTANT_VERTEX_LOCATION: z.string().min(1).default('europe-west1'),
  ASSISTANT_VERTEX_PROJECT: z.string().min(1).optional(),
```

Create `apps/api/src/lib/assistant/model/types.ts` (Wally's own types; nothing from the library):

```ts
import type { z } from 'zod';

/** `provider:model`, the only way a model is named outside the boundary (spec §3.5). */
export interface ModelRef {
  provider: 'vertex' | 'vertex-anthropic';
  model: string;
}

/** One assistant operation as the model sees it. */
export interface TurnTool {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  /** A write: the turn pauses and returns a pending approval instead of executing. */
  needsApproval: boolean;
  execute: (input: unknown) => Promise<unknown>;
}

/** The library's own message objects, stored as JSON on the conversation and never read by Wally. */
export type StoredMessage = unknown;

export interface ApprovalDecision {
  approvalId: string;
  approved: boolean;
  reason?: string;
}

export interface TurnUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

/** What a ledger learns before a model step is dispatched. */
export interface AttemptInfo {
  stepNumber: number;
  messageCount: number;
  maxOutputTokens: number;
}

/** Returned by `onAttempt`; settled once with the step's actual usage. */
export interface AttemptLease {
  settle: (usage: TurnUsage) => Promise<void> | void;
}

export interface TurnInput {
  instructions: string;
  history: StoredMessage[];
  /** Appended as the user's message when present. */
  userMessage?: string;
  /** Answers to pending approvals from the previous turn, appended before the model runs. */
  approvals?: ApprovalDecision[];
  tools: TurnTool[];
  maxOutputTokens: number;
  /** Model steps per turn; a step is one model call. */
  maxSteps: number;
  abortSignal?: AbortSignal;
  /** Called before every model step. Throwing means the step is not dispatched. */
  onAttempt: (info: AttemptInfo) => Promise<AttemptLease>;
}

export interface PendingApproval {
  approvalId: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
  reason?: string;
}

export interface ToolCallRecord {
  toolCallId: string;
  toolName: string;
  input: unknown;
  output?: unknown;
}

export type TurnFinishReason =
  'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other';

export interface TurnOutput {
  text: string;
  pendingApprovals: PendingApproval[];
  toolCalls: ToolCallRecord[];
  usage: TurnUsage;
  steps: number;
  finishReason: TurnFinishReason;
  /** The full history to store: the input history plus everything this turn produced. */
  messages: StoredMessage[];
}

export type TurnRunner = (input: TurnInput) => Promise<TurnOutput>;
```

Create `apps/api/src/lib/assistant/model/config.ts`:

```ts
import type { LanguageModel } from 'ai';
import { createGoogleVertex } from '@ai-sdk/google-vertex';
import { createVertexAnthropic } from '@ai-sdk/google-vertex/anthropic';
import type { Env } from '../../../env.js';
import type { ModelRef } from './types.js';

const PROVIDERS = ['vertex', 'vertex-anthropic'] as const;

/** Parses `provider:model`. Throws on an unknown provider or a malformed value. */
export function parseModelRef(value: string): ModelRef {
  const separator = value.indexOf(':');
  if (separator <= 0) throw new Error(`ASSISTANT_MODEL must be provider:model, got "${value}"`);
  const provider = value.slice(0, separator);
  const model = value.slice(separator + 1);
  if (!(PROVIDERS as readonly string[]).includes(provider))
    throw new Error(
      `Unknown assistant provider "${provider}"; expected one of ${PROVIDERS.join(', ')}`,
    );
  if (!model || model.includes(':')) throw new Error(`Invalid assistant model id "${model}"`);
  return { provider: provider as ModelRef['provider'], model };
}

type VertexEnv = Pick<
  Env,
  'ASSISTANT_VERTEX_LOCATION' | 'ASSISTANT_VERTEX_PROJECT' | 'FIREBASE_PROJECT_ID'
>;

/** Builds the library's model object for a reference. No network call happens here. */
export function resolveLanguageModel(ref: ModelRef, env: VertexEnv): LanguageModel {
  const settings = {
    project: env.ASSISTANT_VERTEX_PROJECT ?? env.FIREBASE_PROJECT_ID,
    location: env.ASSISTANT_VERTEX_LOCATION,
  };
  switch (ref.provider) {
    case 'vertex':
      return createGoogleVertex(settings)(ref.model);
    case 'vertex-anthropic':
      return createVertexAnthropic(settings)(ref.model);
  }
}
```

If the typecheck says `LanguageModel` includes a string form and the test's `.modelId` access does not compile, narrow the return type to the object form the two factories return (for example `ReturnType<ReturnType<typeof createGoogleVertex>>`), and say so in the report.

- [ ] **Step 5: Document the variables**

Append to `apps/api/.env.example` and the API block of `.env.example`:

```
# The deployment's model as provider:model. Providers: vertex, vertex-anthropic.
ASSISTANT_MODEL=vertex:gemini-3.8-flash
# Vertex region and project for the deployment route; the project defaults to FIREBASE_PROJECT_ID.
ASSISTANT_VERTEX_LOCATION=europe-west1
# ASSISTANT_VERTEX_PROJECT=your-gcp-project-id
```

In `docs/DEPLOY.md`, find the section that lists the Cloud Run environment variables (search for `--set-env-vars`) and add one paragraph after it:

```markdown
The assistant is off unless `ASSISTANT_ENABLED=true` is set. When it is on, `ASSISTANT_MODEL`
(`provider:model`, default `vertex:gemini-3.8-flash`), `ASSISTANT_VERTEX_LOCATION`
(default `europe-west1`) and optionally `ASSISTANT_VERTEX_PROJECT` configure the route,
and the Cloud Run service account needs `roles/aiplatform.user`. `GET /health` reports
the configured model without calling it.
```

- [ ] **Step 6: Run the tests and the checks**

Run the command from Step 2. Expected: PASS, 3 boundary tests and 5 config tests.
Run from the worktree root: `pnpm --filter @wally/api typecheck && pnpm --filter @wally/api lint && pnpm format:check`. Expected: pass. Lint must pass with the new rule in place (no existing file imports the library).

- [ ] **Step 7: Commit**

```bash
cd /Users/mr_user/development/apps/wally-assistant && git add apps/api/eslint.config.js apps/api/src/env.ts apps/api/src/lib/assistant/model/types.ts apps/api/src/lib/assistant/model/config.ts apps/api/src/lib/assistant/model/boundary.test.ts apps/api/src/lib/assistant/model/config.test.ts apps/api/.env.example .env.example docs/DEPLOY.md && git -c core.hooksPath=/dev/null commit -m "feat(api): model boundary with lint rule and model configuration" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The turn runner, proven against the library's mock model

**Files:**

- Create: `apps/api/src/lib/assistant/model/runTurn.ts`
- Create: `apps/api/src/lib/assistant/model/index.ts`
- Test: `apps/api/src/lib/assistant/model/runTurn.test.ts`

**Interfaces:**

- Consumes: every type in `model/types.ts` (Task 2); `resolveLanguageModel`, `parseModelRef` (Task 2).
- Produces: `createTurnRunner(model: LanguageModel): TurnRunner` (boundary-internal, used by the tests) and `createConfiguredTurnRunner(env): TurnRunner` (what the rest of the API calls), both re-exported from `model/index.ts` together with the types.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/lib/assistant/model/runTurn.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';
import { createTurnRunner } from './runTurn.js';
import type { AttemptInfo, TurnInput, TurnTool, TurnUsage } from './types.js';

const usage = {
  inputTokens: { total: 10, noCache: 8, cacheRead: 2, cacheWrite: 0 },
  outputTokens: { total: 5, text: 4, reasoning: 1 },
};
const text = (t: string) => ({
  content: [{ type: 'text' as const, text: t }],
  finishReason: { unified: 'stop' as const },
  usage,
  warnings: [],
});
const toolCall = (toolCallId: string, toolName: string, input: Record<string, unknown>) => ({
  content: [{ type: 'tool-call' as const, toolCallId, toolName, input: JSON.stringify(input) }],
  finishReason: { unified: 'tool-calls' as const },
  usage,
  warnings: [],
});

function tools(overrides: Partial<Record<'list_notes' | 'create_note', Partial<TurnTool>>> = {}) {
  const list: TurnTool = {
    name: 'list_notes',
    description: 'List notes',
    inputSchema: z.object({ boardId: z.string() }).strict(),
    needsApproval: false,
    execute: vi.fn(async () => ({ notes: [], truncated: false, total: 0 })),
    ...overrides.list_notes,
  };
  const create: TurnTool = {
    name: 'create_note',
    description: 'Create a note',
    inputSchema: z.object({ boardId: z.string(), input: z.object({ title: z.string() }) }).strict(),
    needsApproval: true,
    execute: vi.fn(async () => ({ id: 'n1', revision: 1 })),
    ...overrides.create_note,
  };
  return { list, create };
}

function attempts() {
  const seen: AttemptInfo[] = [];
  const settled: TurnUsage[] = [];
  const onAttempt = vi.fn(async (info: AttemptInfo) => {
    seen.push(info);
    return { settle: (u: TurnUsage) => void settled.push(u) };
  });
  return { onAttempt, seen, settled };
}

function input(partial: Partial<TurnInput>, t = tools()): TurnInput {
  return {
    instructions: 'You are Wally.',
    history: [],
    userMessage: 'Was ist heute offen?',
    tools: [t.list, t.create],
    maxOutputTokens: 256,
    maxSteps: 4,
    onAttempt: attempts().onAttempt,
    ...partial,
  };
}

describe('createTurnRunner', () => {
  it('returns the text of a plain reply and settles one attempt', async () => {
    const model = new MockLanguageModelV3({ doGenerate: [text('Nichts offen.')] });
    const a = attempts();
    const out = await createTurnRunner(model)(input({ onAttempt: a.onAttempt }));
    expect(out.text).toBe('Nichts offen.');
    expect(out.finishReason).toBe('stop');
    expect(out.steps).toBe(1);
    expect(out.pendingApprovals).toEqual([]);
    expect(a.seen).toEqual([{ stepNumber: 0, messageCount: 1, maxOutputTokens: 256 }]);
    expect(a.settled).toEqual([
      { inputTokens: 10, cachedInputTokens: 2, outputTokens: 5, reasoningTokens: 1 },
    ]);
    expect(out.usage).toEqual({
      inputTokens: 10,
      cachedInputTokens: 2,
      outputTokens: 5,
      reasoningTokens: 1,
    });
    expect(out.messages.length).toBeGreaterThan(1);
  });

  it('executes a read tool and continues to the answer, one attempt per step', async () => {
    const t = tools();
    const model = new MockLanguageModelV3({
      doGenerate: [toolCall('c1', 'list_notes', { boardId: 'b1' }), text('Drei Notizen.')],
    });
    const a = attempts();
    const out = await createTurnRunner(model)(input({ onAttempt: a.onAttempt }, t));
    expect(t.list.execute).toHaveBeenCalledWith({ boardId: 'b1' });
    expect(out.toolCalls).toEqual([
      {
        toolCallId: 'c1',
        toolName: 'list_notes',
        input: { boardId: 'b1' },
        output: { notes: [], truncated: false, total: 0 },
      },
    ]);
    expect(out.text).toBe('Drei Notizen.');
    expect(out.steps).toBe(2);
    expect(a.seen.map((s) => s.stepNumber)).toEqual([0, 1]);
    expect(a.settled).toHaveLength(2);
    expect(out.usage.inputTokens).toBe(20);
  });

  it('pauses a write tool as a pending approval and never executes it', async () => {
    const t = tools();
    const model = new MockLanguageModelV3({
      doGenerate: [
        toolCall('c2', 'create_note', { boardId: 'b1', input: { title: 'Müller anrufen' } }),
      ],
    });
    const out = await createTurnRunner(model)(input({}, t));
    expect(t.create.execute).not.toHaveBeenCalled();
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(out.pendingApprovals).toHaveLength(1);
    expect(out.pendingApprovals[0]).toMatchObject({
      toolCallId: 'c2',
      toolName: 'create_note',
      input: { boardId: 'b1', input: { title: 'Müller anrufen' } },
    });
    expect(out.pendingApprovals[0]!.approvalId).toEqual(expect.any(String));
    expect(out.finishReason).toBe('tool-calls');
  });

  it('executes the write on the continuation that approves it', async () => {
    const t = tools();
    const first = new MockLanguageModelV3({
      doGenerate: [
        toolCall('c2', 'create_note', { boardId: 'b1', input: { title: 'Müller anrufen' } }),
      ],
    });
    const paused = await createTurnRunner(first)(input({}, t));
    const second = new MockLanguageModelV3({ doGenerate: [text('Erledigt.')] });
    const out = await createTurnRunner(second)(
      input(
        {
          history: paused.messages,
          userMessage: undefined,
          approvals: [{ approvalId: paused.pendingApprovals[0]!.approvalId, approved: true }],
        },
        t,
      ),
    );
    expect(t.create.execute).toHaveBeenCalledTimes(1);
    expect(t.create.execute).toHaveBeenCalledWith({
      boardId: 'b1',
      input: { title: 'Müller anrufen' },
    });
    expect(out.toolCalls[0]).toMatchObject({
      toolName: 'create_note',
      output: { id: 'n1', revision: 1 },
    });
    expect(out.text).toBe('Erledigt.');
    expect(out.pendingApprovals).toEqual([]);
  });

  it('never executes a denied write and lets the model reply', async () => {
    const t = tools();
    const first = new MockLanguageModelV3({
      doGenerate: [toolCall('c2', 'create_note', { boardId: 'b1', input: { title: 'x' } })],
    });
    const paused = await createTurnRunner(first)(input({}, t));
    const second = new MockLanguageModelV3({ doGenerate: [text('Verworfen.')] });
    const out = await createTurnRunner(second)(
      input(
        {
          history: paused.messages,
          userMessage: undefined,
          approvals: [
            {
              approvalId: paused.pendingApprovals[0]!.approvalId,
              approved: false,
              reason: 'Discard',
            },
          ],
        },
        t,
      ),
    );
    expect(t.create.execute).not.toHaveBeenCalled();
    expect(out.text).toBe('Verworfen.');
    expect(second.doGenerateCalls).toHaveLength(1);
  });

  it('does not dispatch a step whose attempt is refused', async () => {
    const model = new MockLanguageModelV3({ doGenerate: [text('never')] });
    const onAttempt = vi.fn(async () => {
      throw new Error('OVER_BUDGET');
    });
    await expect(createTurnRunner(model)(input({ onAttempt }))).rejects.toThrow('OVER_BUDGET');
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('dispatches exactly one step when the second attempt is refused', async () => {
    const t = tools();
    const model = new MockLanguageModelV3({
      doGenerate: [toolCall('c1', 'list_notes', { boardId: 'b1' }), text('never')],
    });
    let calls = 0;
    const onAttempt = vi.fn(async () => {
      if (calls++ === 1) throw new Error('OVER_BUDGET');
      return { settle: () => {} };
    });
    await expect(createTurnRunner(model)(input({ onAttempt }, t))).rejects.toThrow('OVER_BUDGET');
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it('surfaces a model error once, without retrying', async () => {
    let n = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        n++;
        throw new Error('provider down');
      },
    });
    await expect(createTurnRunner(model)(input({}))).rejects.toThrow('provider down');
    expect(n).toBe(1);
  });

  it('stops at maxSteps model calls', async () => {
    const t = tools();
    const model = new MockLanguageModelV3({
      doGenerate: async () => toolCall('c', 'list_notes', { boardId: 'b1' }),
    });
    const out = await createTurnRunner(model)(input({ maxSteps: 2 }, t));
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(out.steps).toBe(2);
    expect(out.finishReason).toBe('tool-calls');
  });

  it('runs several read calls from one step', async () => {
    const t = tools();
    const model = new MockLanguageModelV3({
      doGenerate: [
        {
          content: [
            {
              type: 'tool-call' as const,
              toolCallId: 'c1',
              toolName: 'list_notes',
              input: JSON.stringify({ boardId: 'b1' }),
            },
            {
              type: 'tool-call' as const,
              toolCallId: 'c2',
              toolName: 'list_notes',
              input: JSON.stringify({ boardId: 'b1' }),
            },
          ],
          finishReason: { unified: 'tool-calls' as const },
          usage,
          warnings: [],
        },
        text('ok'),
      ],
    });
    const out = await createTurnRunner(model)(input({}, t));
    expect(t.list.execute).toHaveBeenCalledTimes(2);
    expect(out.toolCalls.map((c) => c.toolCallId)).toEqual(['c1', 'c2']);
  });

  it('passes the abort signal to the model call', async () => {
    const model = new MockLanguageModelV3({ doGenerate: [text('ok')] });
    const controller = new AbortController();
    await createTurnRunner(model)(input({ abortSignal: controller.signal }));
    expect(model.doGenerateCalls[0]!.abortSignal).toBe(controller.signal);
  });
});
```

Format the file with Prettier before running.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/mr_user/development/apps/wally-assistant/apps/api && pnpm vitest run src/lib/assistant/model/runTurn.test.ts`
Expected: FAIL, cannot find module `./runTurn.js`.

- [ ] **Step 3: Write the runner**

Create `apps/api/src/lib/assistant/model/runTurn.ts`:

```ts
import {
  generateText,
  stepCountIs,
  tool,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
  type ToolSet,
} from 'ai';
import type { Env } from '../../../env.js';
import { parseModelRef, resolveLanguageModel } from './config.js';
import type {
  AttemptLease,
  PendingApproval,
  ToolCallRecord,
  TurnInput,
  TurnOutput,
  TurnRunner,
  TurnUsage,
} from './types.js';

/**
 * The one function the rest of the API calls (through createConfiguredTurnRunner). Runs a
 * turn with Wally's tools and returns Wally's types. Write tools pause for approval instead
 * of executing. Every model step is announced through `onAttempt` first and settled with
 * its usage afterwards; the library's own retries are off, so every call is one the ledger
 * has seen.
 */
export function createTurnRunner(model: LanguageModel): TurnRunner {
  return async (input: TurnInput): Promise<TurnOutput> => {
    const tools: ToolSet = Object.fromEntries(
      input.tools.map((t) => [
        t.name,
        tool({
          description: t.description,
          inputSchema: t.inputSchema,
          execute: async (args: unknown) => t.execute(args),
        }),
      ]),
    );
    const toolApproval = Object.fromEntries(
      input.tools.map((t) => [t.name, t.needsApproval ? 'user-approval' : 'not-applicable']),
    );
    const messages: ModelMessage[] = [
      ...(input.history as ModelMessage[]),
      ...(input.userMessage !== undefined
        ? [{ role: 'user' as const, content: input.userMessage }]
        : []),
      ...(input.approvals?.length
        ? [
            {
              role: 'tool' as const,
              content: input.approvals.map((a) => ({
                type: 'tool-approval-response' as const,
                approvalId: a.approvalId,
                approved: a.approved,
                ...(a.reason ? { reason: a.reason } : {}),
              })),
            },
          ]
        : []),
    ];

    let lease: AttemptLease | undefined;
    const settled: TurnUsage[] = [];
    const result = await generateText({
      model,
      instructions: input.instructions,
      messages,
      tools,
      toolApproval,
      maxRetries: 0,
      maxOutputTokens: input.maxOutputTokens,
      abortSignal: input.abortSignal,
      stopWhen: stepCountIs(input.maxSteps),
      prepareStep: async ({ stepNumber, messages: stepMessages }) => {
        lease = await input.onAttempt({
          stepNumber,
          messageCount: stepMessages.length,
          maxOutputTokens: input.maxOutputTokens,
        });
        return {};
      },
      onStepEnd: async (step) => {
        const usage = toUsage(step.usage);
        settled.push(usage);
        await lease?.settle(usage);
        lease = undefined;
      },
    });

    const pendingApprovals: PendingApproval[] = result.content
      .filter((part) => part.type === 'tool-approval-request')
      .map((part) => ({
        approvalId: part.approvalId,
        toolCallId: part.toolCall.toolCallId,
        toolName: part.toolCall.toolName,
        input: part.toolCall.input,
        ...(part.reason ? { reason: part.reason } : {}),
      }));
    const toolCalls: ToolCallRecord[] = result.steps.flatMap((step) =>
      step.toolCalls.map((call) => {
        const found = step.toolResults.find((r) => r.toolCallId === call.toolCallId);
        return {
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          input: call.input,
          ...(found ? { output: found.output } : {}),
        };
      }),
    );
    return {
      text: result.text,
      pendingApprovals,
      toolCalls,
      usage: sum(settled),
      steps: result.steps.length,
      finishReason: result.finishReason,
      messages: [...messages, ...result.responseMessages],
    };
  };
}

/** The runner for the deployment's configured model. */
export function createConfiguredTurnRunner(
  env: Pick<
    Env,
    | 'ASSISTANT_MODEL'
    | 'ASSISTANT_VERTEX_LOCATION'
    | 'ASSISTANT_VERTEX_PROJECT'
    | 'FIREBASE_PROJECT_ID'
  >,
): TurnRunner {
  return createTurnRunner(resolveLanguageModel(parseModelRef(env.ASSISTANT_MODEL), env));
}

function toUsage(usage: LanguageModelUsage): TurnUsage {
  return {
    inputTokens: usage.inputTokens ?? 0,
    cachedInputTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    reasoningTokens: usage.outputTokenDetails?.reasoningTokens ?? 0,
  };
}

function sum(all: TurnUsage[]): TurnUsage {
  return all.reduce(
    (acc, u) => ({
      inputTokens: acc.inputTokens + u.inputTokens,
      cachedInputTokens: acc.cachedInputTokens + u.cachedInputTokens,
      outputTokens: acc.outputTokens + u.outputTokens,
      reasoningTokens: acc.reasoningTokens + u.reasoningTokens,
    }),
    { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
  );
}
```

Create `apps/api/src/lib/assistant/model/index.ts`:

```ts
/**
 * The model boundary (ADR-0013). Everything outside src/lib/assistant/model/ imports from
 * here and sees only Wally's own types; the library is an implementation detail.
 */
export { createConfiguredTurnRunner } from './runTurn.js';
export { parseModelRef } from './config.js';
export type {
  ApprovalDecision,
  AttemptInfo,
  AttemptLease,
  ModelRef,
  PendingApproval,
  StoredMessage,
  ToolCallRecord,
  TurnFinishReason,
  TurnInput,
  TurnOutput,
  TurnRunner,
  TurnTool,
  TurnUsage,
} from './types.js';
```

Things the installed types may dispute, each to be resolved against `node_modules/ai/dist/index.d.ts` and stated in the report: the name of the response-messages field on the result (`responseMessages` vs `response.messages`); whether `onStepEnd`'s step carries `toolResults` with an `output` field (vs `result`); whether a tool call part exposes `input` already parsed (the test expects an object); the exact `toolApproval` value type for a static status. The behaviour in the tests is what must hold; the field names in the code above follow the declarations read on 2026-10-15.

- [ ] **Step 4: Run the tests to verify they pass**

Run the command from Step 2. Expected: PASS, 11 tests, no warnings in the output. Then run `src/lib/assistant/model/boundary.test.ts` once more: the new files must not trip the lint rule (they are inside the boundary).

- [ ] **Step 5: Checks and commit**

Run from the worktree root: `pnpm --filter @wally/api typecheck && pnpm --filter @wally/api lint && pnpm format:check`. Expected: pass.

```bash
cd /Users/mr_user/development/apps/wally-assistant && git add apps/api/src/lib/assistant/model/runTurn.ts apps/api/src/lib/assistant/model/index.ts apps/api/src/lib/assistant/model/runTurn.test.ts && git -c core.hooksPath=/dev/null commit -m "feat(api): turn runner behind the model boundary, tested on the library's mock model" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The health endpoint reports the assistant configuration

**Files:**

- Modify: `apps/api/src/routes/health.ts`
- Test: `apps/api/test/health.test.ts`

**Interfaces:**

- Consumes: `loadEnv()`, `parseModelRef` from `apps/api/src/lib/assistant/model/index.js` (the only import the route needs; no model is built).
- Produces: `GET /health` → `{ status: 'ok', assistant: { enabled: boolean, model: string } }`.

- [ ] **Step 1: Write the failing test**

In `apps/api/test/health.test.ts`, replace the body of the existing test's last two lines with:

```ts
expect(res.statusCode).toBe(200);
expect(res.json()).toEqual({
  status: 'ok',
  assistant: { enabled: false, model: 'vertex:gemini-3.8-flash' },
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run the health file with the emulator command from Global Constraints. Expected: FAIL, the response lacks `assistant`.

- [ ] **Step 3: Report the configuration**

Replace the handler in `apps/api/src/routes/health.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { loadEnv } from '../env.js';
import { parseModelRef } from '../lib/assistant/model/index.js';

/**
 * GET /health — no auth, plain 200. Used by Docker/Cloud Run health checks.
 *
 * Deliberately not `/healthz`: Google Front End reserves that exact path on Cloud Run and
 * answers it with its own 404 before the request ever reaches the container.
 *
 * Reports the assistant's configuration so a deploy can be checked without a model call;
 * parsing the reference also fails fast at boot on a malformed ASSISTANT_MODEL.
 */
export default async function healthRoutes(fastify: FastifyInstance) {
  const env = loadEnv();
  const { provider, model } = parseModelRef(env.ASSISTANT_MODEL);
  fastify.get('/health', async () => {
    return {
      status: 'ok',
      assistant: { enabled: env.ASSISTANT_ENABLED, model: `${provider}:${model}` },
    };
  });
}
```

- [ ] **Step 4: Run the test and the checks**

Run the health file. Expected: PASS. Run from the worktree root: `pnpm --filter @wally/api typecheck && pnpm --filter @wally/api lint && pnpm format:check`. Expected: pass; the health route imports only from the boundary's index, which the lint rule allows.

- [ ] **Step 5: Commit**

```bash
cd /Users/mr_user/development/apps/wally-assistant && git add apps/api/src/routes/health.ts apps/api/test/health.test.ts && git -c core.hooksPath=/dev/null commit -m "feat(api): health endpoint reports the assistant switch and model" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review

- **Spec coverage.** §3.2 "It can be switched off", board half: Task 1. §3.5 boundary, lint rule, one run-a-turn function with a hook per attempt, library chosen in ADR-0013 with adapter tests against a fake provider: Tasks 2 and 3. §3.5 "model and provider are configuration": Task 2. The health endpoint (original M2): Task 4. "Accounting is conservative" and the retry rule: `maxRetries: 0` and the unsettled-lease decision in Task 3.
- **Placeholder scan.** None. The four points the installed types may dispute are named with the file to check.
- **Type consistency.** `TurnTool`, `TurnInput`, `TurnOutput`, `AttemptInfo`, `AttemptLease`, `TurnUsage` are defined in Task 2 and used by those names in Task 3. `parseModelRef` (Task 2) is consumed by Tasks 3 and 4. `assistantEnabledFor` (Task 1) takes `Pick<Env, 'ASSISTANT_ENABLED'>`, which the pure test satisfies with a literal.
- **Review Focus.** Each of the five items names its task and its test is in that task's Step 1.
