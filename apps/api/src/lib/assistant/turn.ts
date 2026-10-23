import { randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import type {
  AssistantConversationDto,
  AssistantEntry,
  AssistantTurnRequest,
  EffectiveRole,
  Language,
} from '@wally/shared';
import type { Env } from '../../env.js';
import type { Actor, CommandLogger } from '../commands/index.js';
import { listNotes } from '../commands/queries.js';
import type { AssistantConversationDoc, WhiteboardDoc, WithId } from '../db/types.js';
import { AppError } from '../errors.js';
import { CHARS_PER_TOKEN, estimateTokens } from './budget/estimate.js';
import { reserveAttempt, settleAttempt } from './budget/ledger.js';
import { priceFor } from './budget/prices.js';
import { resolveChips } from './chips.js';
import {
  appendTurn,
  createConversation,
  loadConversation,
  toVisibleConversationDto,
} from './conversations.js';
import {
  toolDefinitionsJson,
  type TurnOutput,
  type TurnRunner,
  type TurnTool,
  type TurnUsage,
} from './model/index.js';
import { modelOperationInputs, operationAnnotations, type OperationName } from './operations.js';
import { buildInstructions } from './prompt.js';
import { runOperation } from './run.js';
import { displayTitle } from './untitled.js';

export const MAX_OUTPUT_TOKENS = 1024;
export const MAX_STEPS = 6;
export const MAX_TOOL_CALLS = 12;
export const TURN_DEADLINE_MS = 60_000;

const READ_TOOLS: { name: OperationName; description: string }[] = [
  {
    name: 'list_notes',
    description:
      'List the notes on the board as compact rows, with optional filters: q (text), status (OPEN, DONE, ALL), priority, horizon, assignedToMe, limit. Reports truncated and total.',
  },
  { name: 'get_note', description: 'The full note: description, subtasks, custom fields, dates.' },
  { name: 'list_members', description: 'The people on the board and their roles.' },
];

export interface TurnDeps {
  db: Firestore;
  env: Env;
  runner: TurnRunner;
  logger?: CommandLogger;
  now?: () => Date;
  deadlineMs?: number;
}
export interface TurnRequestContext {
  actor: Actor;
  language: Language;
  board: WithId<WhiteboardDoc>;
  role: EffectiveRole;
  request: AssistantTurnRequest;
}

/**
 * An untitled note reaches the model under the untitled label, so the model names it the way
 * the board does and its marker resolves to the same words. Presentation only: the operation
 * layer and the stored note are untouched.
 */
function presentTitles(name: OperationName, data: unknown, language: Language): unknown {
  if (name === 'list_notes') {
    const list = data as { notes: { title: string }[] };
    return {
      ...list,
      notes: list.notes.map((row) => ({ ...row, title: displayTitle(row.title, language) })),
    };
  }
  if (name === 'get_note') {
    const note = data as { title: string };
    return { ...note, title: displayTitle(note.title, language) };
  }
  return data;
}

class StoppedTurn extends Error {
  constructor(readonly reason: 'TOOL_LIMIT' | 'TIMEOUT') {
    super(reason);
  }
}

/**
 * Errors raised by Wally's own callbacks (the ledger, the conversation store) pass through the
 * runner unchanged. Anything else the runner throws came from the model provider.
 */
const ownErrors = new WeakSet<object>();
function own(error: unknown): unknown {
  if (error !== null && typeof error === 'object') ownErrors.add(error);
  return error;
}

/** One turn: reserve, run, resolve chips, store. Throws BudgetError and AppError only. */
export async function runAssistantTurn(
  deps: TurnDeps,
  ctx: TurnRequestContext,
): Promise<AssistantConversationDto> {
  const clock = () => deps.now?.() ?? new Date();
  const now = clock();
  const { db, env } = deps;
  const { actor, board, request } = ctx;
  const model = env.ASSISTANT_MODEL;
  const existing = request.conversationId
    ? await loadConversation(db, actor.id, board.id, request.conversationId)
    : null;
  if (request.conversationId && !existing) throw new AppError(404, 'NOT_FOUND', 'Not found');
  if (existing && (existing.status !== 'OPEN' || existing.model !== model))
    throw new AppError(409, 'ASSISTANT_CONVERSATION_CLOSED', 'This conversation is closed');
  // A new conversation is written only once its first model call is reserved, so a turn the
  // budget refuses leaves nothing behind.
  let conversation: WithId<AssistantConversationDoc> | null = existing;
  const ensureConversation = async () =>
    (conversation ??= await createConversation(db, actor.id, board.id, model, now));
  const history = existing?.messages ?? [];

  const controller = new AbortController();
  const deadline = setTimeout(
    () => controller.abort(new StoppedTurn('TIMEOUT')),
    deps.deadlineMs ?? TURN_DEADLINE_MS,
  );
  let toolCalls = 0;
  let partial = false;
  /** Serialized tool results gathered so far this turn: each later step sends them again. */
  let toolResultChars = 0;
  const tools: TurnTool[] = READ_TOOLS.map(({ name, description }) => ({
    name,
    description,
    // The model never names the board: the server binds it below.
    inputSchema: modelOperationInputs[name],
    needsApproval: !operationAnnotations[name].readOnlyHint,
    execute: async (input) => {
      toolCalls++;
      if (toolCalls > MAX_TOOL_CALLS) {
        controller.abort(new StoppedTurn('TOOL_LIMIT'));
        throw new StoppedTurn('TOOL_LIMIT');
      }
      const result = await runOperation(
        {
          db,
          actor,
          boardId: board.id,
          assistantEnabled: true,
          provenance: {
            via: 'assistant',
            conversationId: (await ensureConversation()).id,
            approvalId: 'read-only',
          },
          logger: deps.logger,
        },
        // The board comes last, so it is always the conversation's own; runOperation still
        // checks it against the bound board.
        { name, input: { ...(input as object), boardId: board.id }, operationId: randomUUID() },
      );
      if (name === 'list_notes' && (result.data as { truncated?: boolean }).truncated)
        partial = true;
      const data = presentTitles(name, result.data, ctx.language);
      toolResultChars += JSON.stringify(data ?? null).length;
      return data;
    },
  }));
  const instructions = buildInstructions({
    today: request.today,
    timeZone: request.timeZone,
    role: ctx.role,
    language: ctx.language,
  });
  // The definitions as the library sends them, JSON Schemas included (an upper-bound estimate
  // needs the real serialized size; a zod `_def` omits the object shape).
  const toolDefinitions = await toolDefinitionsJson(tools);
  const price = priceFor(model);
  const caps = {
    dailyTokens: env.ASSISTANT_DAILY_CAP_TOKENS,
    monthlyMicroUsd: env.ASSISTANT_MONTHLY_CAP_MICRO_USD,
  };

  const startedAt = Date.now();
  const userEntry: AssistantEntry = {
    role: 'user',
    text: request.message,
    chips: [],
    partial: false,
    stopped: null,
    at: now.toISOString(),
  };
  let outcome: 'completed' | 'TOOL_LIMIT' | 'TIMEOUT' = 'completed';
  let output: TurnOutput | null = null;
  try {
    output = await deps.runner({
      instructions,
      history,
      userMessage: request.message,
      tools,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      maxSteps: MAX_STEPS,
      abortSignal: controller.signal,
      onAttempt: async (info) => {
        // Everything the step sends: instructions, the stored history, the message, the tool
        // definitions, every tool result this turn has gathered, and a margin per message.
        const inputTokens =
          estimateTokens([instructions, history, request.message, toolDefinitions]) +
          Math.ceil(toolResultChars / CHARS_PER_TOKEN) +
          info.messageCount * 16;
        // A step announced after the turn stopped never reaches the model: reserve nothing.
        if (controller.signal.aborted) throw controller.signal.reason;
        const reservation = await reserveAttempt(db, {
          userId: actor.id,
          now: clock(),
          estimate: { inputTokens, outputTokens: MAX_OUTPUT_TOKENS },
          price,
          caps,
        }).catch((error: unknown) => {
          throw own(error);
        });
        if (controller.signal.aborted) {
          // The turn stopped while the reservation was being written. No model call follows,
          // so settle it at zero now rather than hold its slot until the lease expires.
          await settleAttempt(
            db,
            actor.id,
            reservation.attemptId,
            { inputTokens: 0, outputTokens: 0 },
            clock(),
          ).catch((error: unknown) => {
            throw own(error);
          });
          throw controller.signal.reason;
        }
        await ensureConversation().catch((error: unknown) => {
          throw own(error);
        });
        return {
          // The providers' output count already includes reasoning (thinking) tokens.
          settle: (usage: TurnUsage) =>
            settleAttempt(
              db,
              actor.id,
              reservation.attemptId,
              { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
              clock(),
            ).catch((error: unknown) => {
              throw own(error);
            }),
        };
      },
    });
  } catch (error) {
    const reason = controller.signal.aborted ? controller.signal.reason : error;
    if (reason instanceof StoppedTurn) outcome = reason.reason;
    else if (error instanceof AppError || ownErrors.has(error as object)) throw error;
    else {
      // The provider's message can carry its own wording, ids or quota details: log the
      // shape only, and answer with Wally's own error.
      deps.logger?.warn({
        type: 'assistant.provider_error',
        boardId: board.id,
        name: (error as { name?: unknown } | null)?.name,
        status: (error as { statusCode?: unknown } | null)?.statusCode,
        code: (error as { code?: unknown } | null)?.code,
      });
      throw new AppError(502, 'ASSISTANT_PROVIDER_ERROR', 'The model provider failed');
    }
  } finally {
    clearTimeout(deadline);
  }
  // A stopped turn can still come back with output: when the stop falls in the last allowed
  // step, the loop ends without another model call to throw on the aborted signal. The turn
  // stopped all the same, so its output (which holds the tool error) is not kept.
  const ran = output;
  if (controller.signal.aborted && controller.signal.reason instanceof StoppedTurn) {
    outcome = controller.signal.reason.reason;
    output = null;
  }

  let assistantEntry: AssistantEntry;
  if (output) {
    const visible = new Map(
      (await listNotes(db, actor, board.id, { status: 'ALL' })).map((n) => [
        n.id,
        displayTitle(n.title, ctx.language),
      ]),
    );
    const { text, chips } = resolveChips(output.text, visible);
    assistantEntry = {
      role: 'assistant',
      text,
      chips,
      partial,
      stopped: output.finishReason === 'length' ? 'LENGTH' : null,
      at: clock().toISOString(),
    };
  } else {
    assistantEntry = {
      role: 'assistant',
      text: '',
      chips: [],
      partial: false,
      stopped: outcome === 'completed' ? null : outcome,
      at: clock().toISOString(),
    };
  }
  const target = await ensureConversation();
  const stored = await appendTurn(db, actor.id, target.id, {
    expectedTurns: target.turns,
    expectedBoardRevision: board.revision ?? 0,
    user: userEntry,
    assistant: assistantEntry,
    messages: output ? output.messages : null,
    usage: output ? output.usage : null,
    toolCalls: Math.min(toolCalls, MAX_TOOL_CALLS),
    now: clock(),
  });
  // Contents-free by construction: ids, counts, usage and timing, never the message or reply.
  deps.logger?.info({
    type: 'assistant.turn',
    conversationId: target.id,
    boardId: board.id,
    outcome,
    // What ran, even when a stop discarded it from the conversation.
    steps: ran?.steps ?? 0,
    toolCalls,
    usage: ran?.usage ?? null,
    // Steps the provider reported no usage for: their reservations stay charged, unsettled.
    unsettledSteps: ran?.unsettledSteps ?? 0,
    ms: Date.now() - startedAt,
  });
  // Earlier entries' chips are rechecked too: a note may have left the caller's sight since.
  return toVisibleConversationDto(db, actor, stored);
}
