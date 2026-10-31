import type { Database } from '../postgres/client.js';
import type { Env } from '../../env.js';
import type { CommandLogger } from '../commands/index.js';
import { AppError } from '../errors.js';
import { estimateTokens } from './budget/estimate.js';
import { trackAttempts } from './budget/ledger.js';
import { priceFor } from './budget/prices.js';
import { retryDelayMs, withOneRetry, type SuggestionInput } from './model/index.js';

/** A retry starts only when at least this much of the deadline is left for it. */
export const MIN_ATTEMPT_MS = 4_000;

export interface MeteredCallDeps {
  db: Database;
  env: Env;
  logger?: CommandLogger;
  now?: () => Date;
}

/** One structured call, as a capture or a tidy asks for it. */
export interface MeteredCall<Output> {
  actorId: string;
  boardId: string;
  instructions: string;
  prompt: string;
  /** The response schema as the call sends it, so the estimate counts its real size. */
  schema: string;
  /** The answer's allowance; the runner adds the model's thinking room on top. */
  maxOutputTokens: number;
  deadlineMs: number;
  run: (input: SuggestionInput) => Promise<Output>;
}

/**
 * One structured model call for a capture or a tidy, metered: every attempt reserves before it
 * is dispatched and settles with its usage (or is released without it), a busy or failing
 * provider gets one more try within the deadline, and the deadline aborts the call. Throws
 * BudgetError and AppError only; the provider's own error becomes 502 without its wording.
 * Returns the runner's output and when the call started, for the caller's log line.
 */
export async function runMeteredCall<Output>(
  deps: MeteredCallDeps,
  call: MeteredCall<Output>,
): Promise<{ output: Output; startedAt: number }> {
  const clock = () => deps.now?.() ?? new Date();
  const { instructions, prompt, schema, boardId } = call;
  const price = priceFor(deps.env.ASSISTANT_MODEL);
  const caps = {
    dailyTokens: deps.env.ASSISTANT_DAILY_CAP_TOKENS,
    monthlyMicroUsd: deps.env.ASSISTANT_MONTHLY_CAP_MICRO_USD,
  };
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), call.deadlineMs);
  const startedAt = Date.now();
  const attempts = trackAttempts(deps.db, call.actorId, {
    clock,
    // The slot then stays until its lease expires; said by shape only, like a provider error.
    onReleaseError: (error) =>
      deps.logger?.warn({
        type: 'assistant.release_failed',
        boardId,
        name: (error as { name?: unknown } | null)?.name,
        code: (error as { code?: unknown } | null)?.code,
      }),
  });
  try {
    // A busy or failing provider gets one more try after a short pause, within the deadline.
    // Each try frees whatever slot it still holds before the next one reserves.
    const output = await withOneRetry(
      () =>
        call
          .run({
            instructions,
            prompt,
            maxOutputTokens: call.maxOutputTokens,
            abortSignal: controller.signal,
            onAttempt: async (info) => {
              const { attemptId } = await attempts.reserve({
                estimate: {
                  inputTokens: estimateTokens([instructions, prompt, schema]) + 16,
                  // The runner's allowance, thinking room included: everything the call may bill.
                  outputTokens: info.maxOutputTokens,
                },
                price,
                caps,
              });
              return {
                settle: (usage) =>
                  attempts.settle(attemptId, {
                    inputTokens: usage.inputTokens,
                    outputTokens: usage.outputTokens,
                  }),
                release: () => attempts.release(attemptId),
              };
            },
          })
          .finally(attempts.releaseRest),
      {
        signal: controller.signal,
        deadlineAt: startedAt + call.deadlineMs,
        minAttemptMs: MIN_ATTEMPT_MS,
        delayMs: retryDelayMs,
      },
    );
    return { output, startedAt };
  } catch (error) {
    if (error instanceof AppError) throw error;
    // Our own deadline, not the provider's fault: said as a timeout.
    if (controller.signal.aborted) {
      deps.logger?.warn({
        type: 'assistant.timeout',
        boardId,
        ms: Date.now() - startedAt,
      });
      throw new AppError(504, 'ASSISTANT_TIMEOUT', 'The model did not answer in time');
    }
    deps.logger?.warn({
      type: 'assistant.provider_error',
      boardId,
      name: (error as { name?: unknown } | null)?.name,
      status: (error as { statusCode?: unknown } | null)?.statusCode,
    });
    throw new AppError(502, 'ASSISTANT_PROVIDER_ERROR', 'The model provider failed');
  } finally {
    clearTimeout(deadline);
  }
}
