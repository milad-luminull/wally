import { generateText, NoObjectGeneratedError, Output, type LanguageModel } from 'ai';
import { z } from 'zod';
import type { Env } from '../../../env.js';
import {
  defaultProviderOptions,
  parseModelRef,
  resolveLanguageModel,
  type ModelProviderOptions,
} from './config.js';
import type { SuggestionInput, SuggestionOutput, SuggestionRunner } from './types.js';
import { toUsage } from './usage.js';

const confidence = z.number().min(0).max(1);
const reason = z.string().max(120);
/** What the model must return: strict JSON, validated by the library against this schema. */
export const modelSuggestionSchema = z.object({
  dueDate: z
    .object({ value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), confidence, reason })
    .nullable(),
  priority: z.object({ value: z.enum(['HOCH', 'NIEDRIG']), confidence, reason }).nullable(),
  assignee: z.object({ memberId: z.string().min(1), confidence, reason }).nullable(),
});

/**
 * One structured call (WALLYBOT_INLINE.md §4). The attempt is announced first and settled with
 * the reported usage afterwards; the library's own retries are off. A reply that does not
 * validate is "nothing proposed", not an error: the person just sees no dot (§3.3). Anything
 * else the library throws is the provider's and passes through.
 */
export function createSuggestionRunner(
  model: LanguageModel,
  options: { providerOptions?: ModelProviderOptions } = {},
): SuggestionRunner {
  return async (input: SuggestionInput): Promise<SuggestionOutput> => {
    const lease = await input.onAttempt({
      stepNumber: 0,
      messageCount: 1,
      maxOutputTokens: input.maxOutputTokens,
    });
    try {
      const result = await generateText({
        model,
        instructions: input.instructions,
        prompt: input.prompt,
        output: Output.object({ schema: modelSuggestionSchema }),
        maxRetries: 0,
        maxOutputTokens: input.maxOutputTokens,
        ...(options.providerOptions ? { providerOptions: options.providerOptions } : {}),
        abortSignal: input.abortSignal,
      });
      const usage = toUsage(result.usage);
      if (usage) await lease.settle(usage);
      return { fields: result.output, usage, finishReason: result.finishReason };
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        const usage = error.usage ? toUsage(error.usage) : null;
        if (usage) await lease.settle(usage);
        return { fields: null, usage, finishReason: error.finishReason ?? 'other' };
      }
      throw error;
    }
  };
}

/** The runner for the deployment's configured model. */
export function createConfiguredSuggestionRunner(
  env: Pick<
    Env,
    | 'ASSISTANT_MODEL'
    | 'ASSISTANT_VERTEX_LOCATION'
    | 'ASSISTANT_VERTEX_PROJECT'
    | 'FIREBASE_PROJECT_ID'
    | 'FIREBASE_CLIENT_EMAIL'
    | 'FIREBASE_PRIVATE_KEY'
  >,
): SuggestionRunner {
  const ref = parseModelRef(env.ASSISTANT_MODEL);
  return createSuggestionRunner(resolveLanguageModel(ref, env), {
    providerOptions: defaultProviderOptions(ref),
  });
}
