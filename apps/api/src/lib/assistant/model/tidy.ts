import {
  generateText,
  jsonSchema,
  NoObjectGeneratedError,
  Output,
  zodSchema,
  type LanguageModel,
} from 'ai';
import { z } from 'zod';
import { TIDY_MAX_UNDATED } from '@wally/shared';
import type { Env } from '../../../env.js';
import {
  parseModelRef,
  resolveLanguageModel,
  suggestionCallSettings,
  type SuggestionCallSettings,
} from './config.js';
import type { TidyInput, TidyOutput, TidyRunner } from './types.js';
import { toUsage } from './usage.js';

const confidence = z.number().min(0).max(1);
/**
 * What the model is asked for: the undated notes that belong to This week or Later. Only
 * the keywords Gemini's structured-output page documents reach the provider (see
 * `modelSuggestionWireSchema`); the lengths are checked by `modelTidySchema`.
 * Source: https://ai.google.dev/gemini-api/docs/structured-output (read 2026-10-17).
 */
export const modelTidyWireSchema = z.object({
  moves: z
    .array(
      z.object({
        noteId: z.string().describe('The id of a note from the list.'),
        horizon: z.enum(['DIESE_WOCHE', 'SPAETER']),
        confidence,
        reason: z.string(),
      }),
    )
    .max(TIDY_MAX_UNDATED)
    .describe('Only the notes whose words place them later than today.'),
});

export const TIDY_REASON_MAX = 120;
const move = z.object({
  noteId: z.string().min(1),
  horizon: z.enum(['DIESE_WOCHE', 'SPAETER']),
  confidence,
  reason: z.string().transform((text) => text.slice(0, TIDY_REASON_MAX)),
});
/**
 * What a reply must be once it arrives: a move that does not fit (no id, a horizon that is
 * not a move, a confidence out of range) drops alone, so it never costs the batch its good
 * moves; the first `TIDY_MAX_UNDATED` are kept.
 */
export const modelTidySchema = z.object({
  moves: z.array(z.unknown()).transform((items) =>
    items
      .map((item) => move.safeParse(item))
      .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
      .slice(0, TIDY_MAX_UNDATED),
  ),
});

/**
 * The schema the call sends and the one check its reply gets, as for a suggestion: the
 * provider is told the wire shape, `maxItems` included; the reply is read with
 * `modelTidySchema` alone, so one bad move costs only itself.
 */
const replySchema = jsonSchema<z.output<typeof modelTidySchema>>(
  () => zodSchema(modelTidyWireSchema).jsonSchema,
  {
    validate: (value) => {
      const checked = modelTidySchema.safeParse(value);
      return checked.success
        ? { success: true, value: checked.data }
        : { success: false, error: checked.error };
    },
  },
);

/**
 * One structured call (0005-wallybot-inline.md §4), shaped like a capture's: announced and settled
 * through the lease, the library's retries off, thinking room added to the allowance so the
 * ledger reserves what can be billed. A reply that does not validate is "nothing to move".
 */
/** What a call the provider refused with an error status costs: nothing. */
const NOTHING_BILLED = {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
};

export function createTidyRunner(
  model: LanguageModel,
  options: Partial<SuggestionCallSettings> = {},
): TidyRunner {
  const thinkingTokens = options.thinkingTokens ?? 0;
  return async (input: TidyInput): Promise<TidyOutput> => {
    const maxOutputTokens = input.maxOutputTokens + thinkingTokens;
    const lease = await input.onAttempt({ stepNumber: 0, messageCount: 1, maxOutputTokens });
    try {
      const result = await generateText({
        model,
        instructions: input.instructions,
        prompt: input.prompt,
        output: Output.object({ schema: replySchema }),
        maxRetries: 0,
        maxOutputTokens,
        ...(options.providerOptions ? { providerOptions: options.providerOptions } : {}),
        abortSignal: input.abortSignal,
      });
      const usage = toUsage(result.usage);
      // No usage reported: the reservation stays charged, the slot is freed (R7).
      if (usage) await lease.settle(usage);
      else await lease.release();
      return { moves: result.output, usage, finishReason: result.finishReason };
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        const usage = error.usage ? toUsage(error.usage) : null;
        if (usage) await lease.settle(usage);
        else await lease.release();
        return { moves: null, usage, finishReason: error.finishReason ?? 'other' };
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

let schemaJson: Promise<string> | null = null;
/** The response schema as the library sends it, serialised, so the reservation counts it. */
export function tidySchemaJson(): Promise<string> {
  schemaJson ??= Promise.resolve(zodSchema(modelTidyWireSchema).jsonSchema).then((schema) =>
    JSON.stringify(schema),
  );
  return schemaJson;
}

/** The runner for the deployment's configured model; a tidy's answer is as small as a capture's. */
export function createConfiguredTidyRunner(
  env: Pick<
    Env,
    | 'ASSISTANT_MODEL'
    | 'ASSISTANT_VERTEX_LOCATION'
    | 'ASSISTANT_VERTEX_PROJECT'
    | 'FIREBASE_PROJECT_ID'
    | 'FIREBASE_CLIENT_EMAIL'
    | 'FIREBASE_PRIVATE_KEY'
  >,
): TidyRunner {
  const ref = parseModelRef(env.ASSISTANT_MODEL);
  return createTidyRunner(resolveLanguageModel(ref, env), suggestionCallSettings(ref));
}
