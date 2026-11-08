import { generateText, NoObjectGeneratedError, Output, type LanguageModel, type Schema } from 'ai';
import type { SuggestionCallSettings } from './config.js';
import type { TidyInput, TurnFinishReason, TurnUsage } from './types.js';
import { toFinishReason } from './finishReason.js';
import { toUsage } from './usage.js';

/** What a call the provider refused with an error status costs: nothing. */
const NOTHING_BILLED = {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
};

export interface StructuredOutput<T> {
  /** null when the model produced nothing that validates against the schema. */
  output: T | null;
  usage: TurnUsage | null;
  finishReason: TurnFinishReason;
}

/**
 * One structured call (RFC-0005-wallybot-inline.md §4), shaped like a capture's: announced and
 * settled through the lease, the library's retries off, thinking room added to the allowance so
 * the ledger reserves what can be billed. A reply that does not validate is `output: null`.
 */
export function createStructuredRunner<T>(
  model: LanguageModel,
  schema: Schema<T>,
  options: Partial<SuggestionCallSettings> = {},
): (input: TidyInput) => Promise<StructuredOutput<T>> {
  const thinkingTokens = options.thinkingTokens ?? 0;
  return async (input) => {
    const maxOutputTokens = input.maxOutputTokens + thinkingTokens;
    const lease = await input.onAttempt({ stepNumber: 0, messageCount: 1, maxOutputTokens });
    try {
      const result = await generateText({
        model,
        instructions: input.instructions,
        prompt: input.prompt,
        output: Output.object({ schema }),
        maxRetries: 0,
        maxOutputTokens,
        ...(options.providerOptions ? { providerOptions: options.providerOptions } : {}),
        abortSignal: input.abortSignal,
      });
      const usage = toUsage(result.usage);
      // No usage reported: the reservation stays charged, the slot is freed (R7).
      if (usage) await lease.settle(usage);
      else await lease.release();
      return {
        output: result.output,
        usage,
        finishReason: toFinishReason(result.finishReason),
      };
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        const usage = error.usage ? toUsage(error.usage) : null;
        if (usage) await lease.settle(usage);
        else await lease.release();
        return {
          output: null,
          usage,
          finishReason: toFinishReason(error.finishReason ?? 'other'),
        };
      }
      // The provider answered with an error status (busy, a fault): nothing was processed or
      // billed, so the attempt settles at zero. A dropped connection or an aborted call leaves
      // the usage unknown: the reservation stays charged (R7). Either way the in-flight slot
      // is free at once, so a retry or the person's next call is not refused as busy.
      // A settlement that fails is not the provider's error: the provider's is what the
      // caller reads (and retries), and the slot is released instead.
      if (typeof (error as { statusCode?: unknown } | null)?.statusCode === 'number')
        await Promise.resolve(lease.settle(NOTHING_BILLED)).catch(() => lease.release());
      else await lease.release();
      throw error;
    }
  };
}
