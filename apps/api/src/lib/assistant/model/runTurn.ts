import {
  generateText,
  stepCountIs,
  tool,
  type LanguageModel,
  type ModelMessage,
  type ToolApprovalStatus,
  type ToolResultPart,
  type ToolSet,
  zodSchema,
} from 'ai';
import type { Env } from '../../../env.js';
import {
  defaultProviderOptions,
  parseModelRef,
  resolveLanguageModel,
  type ModelProviderOptions,
} from './config.js';
import type {
  AttemptLease,
  PendingApproval,
  ToolCallRecord,
  TurnInput,
  TurnOutput,
  TurnRunner,
  TurnTool,
  TurnUsage,
} from './types.js';
import { toUsage } from './usage.js';

/**
 * The one function the rest of the API calls (through createConfiguredTurnRunner). Runs a
 * turn with Wally's tools and returns Wally's types. Write tools pause for approval instead
 * of executing. Every model step is announced through `onAttempt` first and settled with
 * its usage afterwards; the library's own retries are off, so every call is one the ledger
 * has seen.
 */
export function createTurnRunner(
  model: LanguageModel,
  options: { providerOptions?: ModelProviderOptions } = {},
): TurnRunner {
  return async (input: TurnInput): Promise<TurnOutput> => {
    // The library collects approval responses only from a trailing tool message; a user
    // message after it would run the approved write and then fail before any model call.
    if (input.userMessage !== undefined && input.approvals?.length) {
      throw new Error('A turn carries either a user message or approval decisions, not both');
    }
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
    // What is stored: the history as it was, plus this turn.
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
    // On a continuation that approves a write, the library runs the write before the first
    // model step, so before prepareStep. Take the step-0 attempt here instead: a refused
    // attempt then stops the turn before the write runs, not after it. The count matches what
    // prepareStep would report: the library adds one tool message holding the write's result.
    if (input.approvals?.some((a) => a.approved)) {
      lease = await input.onAttempt({
        stepNumber: 0,
        messageCount: messages.length + 1,
        maxOutputTokens: input.maxOutputTokens,
      });
    }
    const forceRead = input.userMessage !== undefined && !input.approvals?.length;
    const settled: TurnUsage[] = [];
    let unsettledSteps = 0;
    const executed: ToolCallRecord[] = [];
    // A step that throws (the provider failed, the call was aborted) never reaches onStepEnd,
    // so its lease is released here; without that its slot would stay held.
    const result = await generateText({
      model,
      instructions: input.instructions,
      // What is sent: earlier tool results elided, so a continuation reads the board again.
      messages: elideEarlierToolResults(messages),
      tools,
      toolApproval,
      maxRetries: 0,
      maxOutputTokens: input.maxOutputTokens,
      ...(options.providerOptions ? { providerOptions: options.providerOptions } : {}),
      abortSignal: input.abortSignal,
      stopWhen: stepCountIs(input.maxSteps),
      prepareStep: async ({ stepNumber, messages: stepMessages }) => {
        if (stepNumber === 0 && lease) return {};
        lease = await input.onAttempt({
          stepNumber,
          messageCount: stepMessages.length,
          maxOutputTokens: input.maxOutputTokens,
        });
        // A question reads the board before it is answered: left to choose, the model can
        // answer without reading (RFC-0003-wally-agent.md §3.4). The first step of a turn that carries
        // a user message must call a tool; prepareStep's `toolChoice` applies to that step only
        // (ai docs/03-ai-sdk-core/15-tools-and-tool-calling.mdx, "prepareStep callback" and
        // "Tool Choice"), so later steps stay automatic and can answer. A response without a
        // tool call then throws ToolChoiceViolationError, which the caller reports as a
        // provider error. A continuation that answers approvals is not forced.
        if (stepNumber === 0 && forceRead) return { toolChoice: 'required' };
        return {};
      },
      onStepEnd: async (step) => {
        const usage = toUsage(step.usage);
        // Usage the provider did not report keeps the reservation (RFC-0003-wally-agent.md §3.2):
        // the step may have been billed, so its worst case stays charged; its slot is freed
        // before the next step reserves one.
        if (usage) {
          settled.push(usage);
          await lease?.settle(usage);
        } else {
          unsettledSteps++;
          await lease?.release();
        }
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
    }).catch(async (error: unknown) => {
      await lease?.release();
      throw error;
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
      unsettledSteps,
      steps: result.steps.length,
      finishReason: result.finishReason,
      messages: [...messages, ...result.responseMessages],
    };
  };
}

/**
 * The tool definitions as the library sends them: name, description and the JSON Schema it
 * derives from each input schema. For sizing a request outside the boundary.
 */
export async function toolDefinitionsJson(tools: TurnTool[]): Promise<string> {
  const definitions = await Promise.all(
    tools.map(async (t) => ({
      name: t.name,
      description: t.description,
      inputSchema: await zodSchema(t.inputSchema).jsonSchema,
    })),
  );
  return JSON.stringify(definitions);
}

export const ELIDED_TOOL_RESULT = '[earlier result omitted; read the board again]';

/**
 * Board content from an earlier turn is not reused as context (RFC-0003-wally-agent.md §3.4): the
 * caller may no longer see it, and re-sending it would spend the caps on every turn. Every
 * tool result already in the history is replaced by a short placeholder, per call; the tool
 * calls and the assistant's text stay, so the model still sees what it did. A denied write
 * holds no board content and keeps its denial. Results produced during this call are not in
 * `history` and reach the model in full.
 */
function elideEarlierToolResults(history: ModelMessage[]): ModelMessage[] {
  const elided: ToolResultPart['output'] = { type: 'text', value: ELIDED_TOOL_RESULT };
  return history.map((message): ModelMessage => {
    if (
      (message.role !== 'tool' && message.role !== 'assistant') ||
      !Array.isArray(message.content)
    )
      return message;
    const content = (message.content as { type: string }[]).map((part) =>
      part.type === 'tool-result' && (part as ToolResultPart).output.type !== 'execution-denied'
        ? { ...(part as ToolResultPart), output: elided }
        : part,
    );
    return { ...message, content } as ModelMessage;
  });
}

/** The runner for the deployment's configured model. */
export function createConfiguredTurnRunner(
  env: Pick<
    Env,
    | 'ASSISTANT_MODEL'
    | 'ASSISTANT_VERTEX_LOCATION'
    | 'ASSISTANT_VERTEX_PROJECT'
    | 'FIREBASE_PROJECT_ID'
    | 'FIREBASE_CLIENT_EMAIL'
    | 'FIREBASE_PRIVATE_KEY'
  >,
): TurnRunner {
  const ref = parseModelRef(env.ASSISTANT_MODEL);
  return createTurnRunner(resolveLanguageModel(ref, env), {
    providerOptions: defaultProviderOptions(ref),
  });
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
