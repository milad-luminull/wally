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
import { estimateTokens } from './budget/estimate.js';
import { reserveAttempt, settleAttempt } from './budget/ledger.js';
import { priceFor } from './budget/prices.js';
import { resolveChips } from './chips.js';
import {
  appendTurn,
  createConversation,
  loadConversation,
  toConversationDto,
} from './conversations.js';
import type { TurnOutput, TurnRunner, TurnTool, TurnUsage } from './model/index.js';
import { operationAnnotations, operationInputs, type OperationName } from './operations.js';
import { buildInstructions } from './prompt.js';
import { runOperation } from './run.js';

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

class StoppedTurn extends Error {
  constructor(readonly reason: 'TOOL_LIMIT' | 'TIMEOUT') {
    super(reason);
  }
}

/** One turn: reserve, run, resolve chips, store. Throws BudgetError and AppError only. */
export async function runAssistantTurn(
  deps: TurnDeps,
  ctx: TurnRequestContext,
): Promise<AssistantConversationDto> {
  const now = deps.now?.() ?? new Date();
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
  const tools: TurnTool[] = READ_TOOLS.map(({ name, description }) => ({
    name,
    description,
    inputSchema: operationInputs[name],
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
        { name, input, operationId: randomUUID() },
      );
      if (name === 'list_notes' && (result.data as { truncated?: boolean }).truncated)
        partial = true;
      return result.data;
    },
  }));
  const instructions = buildInstructions({
    today: request.today,
    timeZone: request.timeZone,
    role: ctx.role,
    language: ctx.language,
  });
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
        const inputTokens =
          estimateTokens([
            instructions,
            history,
            request.message,
            tools.map((t) => [t.name, t.description]),
          ]) +
          info.messageCount * 16;
        // A step announced after the turn stopped never reaches the model: reserve nothing.
        if (controller.signal.aborted) throw controller.signal.reason;
        const reservation = await reserveAttempt(db, {
          userId: actor.id,
          now: deps.now?.() ?? new Date(),
          estimate: { inputTokens, outputTokens: MAX_OUTPUT_TOKENS },
          price,
          caps,
        });
        if (controller.signal.aborted) {
          // The turn stopped while the reservation was being written. No model call follows,
          // so settle it at zero now rather than hold its slot until the lease expires.
          await settleAttempt(
            db,
            actor.id,
            reservation.attemptId,
            { inputTokens: 0, outputTokens: 0 },
            deps.now?.() ?? new Date(),
          );
          throw controller.signal.reason;
        }
        await ensureConversation();
        return {
          settle: (usage: TurnUsage) =>
            settleAttempt(
              db,
              actor.id,
              reservation.attemptId,
              {
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens + usage.reasoningTokens,
              },
              deps.now?.() ?? new Date(),
            ),
        };
      },
    });
  } catch (error) {
    const reason = controller.signal.aborted ? controller.signal.reason : error;
    if (reason instanceof StoppedTurn) outcome = reason.reason;
    else throw error;
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
      (await listNotes(db, actor, board.id, { status: 'ALL' })).map((n) => [n.id, n.title]),
    );
    const { text, chips } = resolveChips(output.text, visible);
    assistantEntry = {
      role: 'assistant',
      text,
      chips,
      partial,
      stopped: output.finishReason === 'length' ? 'LENGTH' : null,
      at: new Date().toISOString(),
    };
  } else {
    assistantEntry = {
      role: 'assistant',
      text: '',
      chips: [],
      partial: false,
      stopped: outcome === 'completed' ? null : outcome,
      at: new Date().toISOString(),
    };
  }
  const target = await ensureConversation();
  const stored = await appendTurn(db, actor.id, target.id, {
    expectedTurns: target.turns,
    user: userEntry,
    assistant: assistantEntry,
    messages: output ? output.messages : null,
    usage: output ? output.usage : null,
    toolCalls: Math.min(toolCalls, MAX_TOOL_CALLS),
    now: deps.now?.() ?? new Date(),
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
    ms: Date.now() - startedAt,
  });
  return toConversationDto(stored);
}
