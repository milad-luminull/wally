import { generateText, NoObjectGeneratedError, Output, zodSchema, type LanguageModel } from 'ai';
import { z } from 'zod';
import type { Env } from '../../../env.js';
import {
  parseModelRef,
  resolveLanguageModel,
  suggestionCallSettings,
  type SuggestionCallSettings,
} from './config.js';
import type { SuggestionInput, SuggestionOutput, SuggestionRunner } from './types.js';
import { toUsage } from './usage.js';

const confidence = z.number().min(0).max(1);
/**
 * What the model is asked for. Only keywords Gemini's structured-output page documents reach
 * the provider: type, properties, required, additionalProperties, enum, minimum and maximum,
 * and a null branch (the library writes .nullable() as anyOf with a null type, the form that
 * page's own example uses). Its string keywords (pattern, minLength, maxLength) are not on
 * that list, so the format and the lengths are checked by `modelSuggestionSchema` instead.
 */
export const modelSuggestionWireSchema = z.object({
  dueDate: z
    .object({
      value: z.string().describe('A calendar date, YYYY-MM-DD.'),
      confidence,
      reason: z.string(),
    })
    .nullable(),
  priority: z
    .object({ value: z.enum(['HOCH', 'NIEDRIG']), confidence, reason: z.string() })
    .nullable(),
  assignee: z.object({ memberId: z.string(), confidence, reason: z.string() }).nullable(),
});

/** The longest reason the card shows (the shared `suggestionFieldsSchema` allows no more). */
export const SUGGESTION_REASON_MAX = 120;
/**
 * A reason that runs long is cut, not refused: one wordy reason must not cost the person
 * every field of an otherwise good proposal.
 */
const reason = z.string().transform((text) => text.slice(0, SUGGESTION_REASON_MAX));
/**
 * What a suggestion must be once it arrives: the wire shape, plus the format and lengths. The
 * date is a real calendar day (`2026-04-31` is refused), the same check the response schema
 * makes, so a record that is stored can always be answered.
 */
export const modelSuggestionSchema = z.object({
  dueDate: z.object({ value: z.string().date(), confidence, reason }).nullable(),
  priority: z.object({ value: z.enum(['HOCH', 'NIEDRIG']), confidence, reason }).nullable(),
  assignee: z.object({ memberId: z.string().min(1), confidence, reason }).nullable(),
});

/**
 * One structured call (WALLYBOT_INLINE.md §4). The attempt is announced first and settled with
 * the reported usage afterwards; the library's own retries are off. The call may produce the
 * answer's allowance plus the model's thinking room (`thinkingTokens`), and that total is
 * what it announces, so the ledger reserves what can actually be billed. A reply that does
 * not validate is "nothing proposed", not an error: the person just sees no dot (§3.3).
 * Anything else the library throws is the provider's and passes through.
 */
export function createSuggestionRunner(
  model: LanguageModel,
  options: Partial<SuggestionCallSettings> = {},
): SuggestionRunner {
  const thinkingTokens = options.thinkingTokens ?? 0;
  return async (input: SuggestionInput): Promise<SuggestionOutput> => {
    const maxOutputTokens = input.maxOutputTokens + thinkingTokens;
    const lease = await input.onAttempt({ stepNumber: 0, messageCount: 1, maxOutputTokens });
    try {
      const result = await generateText({
        model,
        instructions: input.instructions,
        prompt: input.prompt,
        output: Output.object({ schema: modelSuggestionWireSchema }),
        maxRetries: 0,
        maxOutputTokens,
        ...(options.providerOptions ? { providerOptions: options.providerOptions } : {}),
        abortSignal: input.abortSignal,
      });
      const usage = toUsage(result.usage);
      if (usage) await lease.settle(usage);
      const checked = modelSuggestionSchema.safeParse(result.output);
      return {
        fields: checked.success ? checked.data : null,
        usage,
        finishReason: result.finishReason,
      };
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

let schemaJson: Promise<string> | null = null;
/**
 * The response schema as the library sends it, serialised: part of every suggestion call's
 * input, so the reservation counts it (as `toolDefinitionsJson` does for a turn's tools).
 */
export function suggestionSchemaJson(): Promise<string> {
  schemaJson ??= Promise.resolve(zodSchema(modelSuggestionWireSchema).jsonSchema).then((schema) =>
    JSON.stringify(schema),
  );
  return schemaJson;
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
  return createSuggestionRunner(resolveLanguageModel(ref, env), suggestionCallSettings(ref));
}
