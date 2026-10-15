import {
  generateText,
  stepCountIs,
  tool,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
  type ToolApprovalStatus,
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
      input.tools.map((t): [string, ToolApprovalStatus] => [
        t.name,
        t.needsApproval ? 'user-approval' : 'not-applicable',
      ]),
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
    const executed: ToolCallRecord[] = [];
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
      onToolExecutionEnd: ({ toolCall, toolOutput }) => {
        executed.push({
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          input: toolCall.input,
          ...(toolOutput.type === 'tool-result' ? { output: toolOutput.output } : {}),
        });
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
    const stepToolCalls: ToolCallRecord[] = result.steps.flatMap((step) =>
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
    // An approved write from the previous turn runs before the first model step, so it
    // belongs to no step; the library reports it only through onToolExecutionEnd.
    const stepToolCallIds = new Set(stepToolCalls.map((call) => call.toolCallId));
    const toolCalls: ToolCallRecord[] = [
      ...executed.filter((call) => !stepToolCallIds.has(call.toolCallId)),
      ...stepToolCalls,
    ];
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
