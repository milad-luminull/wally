import {
  generateText,
  jsonSchema,
  NoObjectGeneratedError,
  Output,
  zodSchema,
  type LanguageModel,
} from 'ai';
import { z } from 'zod';
import {
  FIELD_KEY_MAX_LENGTH,
  FIELD_VALUE_MAX_LENGTH,
  NOTE_TITLE_MAX_LENGTH,
  SUBTASK_TEXT_MAX_LENGTH,
  SUGGESTION_MAX_SUBTASKS,
} from '@wally/shared';
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
 * items and maxItems for an array, description, and a null branch (the library writes
 * .nullable() as anyOf with a null type, the form that page's own example uses). Its string
 * keywords (pattern, minLength, maxLength) are not on that list, so the format and the
 * lengths are checked by `modelSuggestionSchema` instead.
 * Source: https://ai.google.dev/gemini-api/docs/structured-output (read 2026-10-17).
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
  title: z
    .object({
      value: z.string().describe('A shorter title with the same meaning, or null.'),
      confidence,
      reason: z.string(),
    })
    .nullable(),
  reference: z
    .object({
      key: z.string().describe("A property name, reusing one of the board's when it fits."),
      value: z.string(),
      confidence,
      reason: z.string(),
    })
    .nullable(),
  subtasks: z
    .object({
      items: z
        .array(z.string())
        .max(SUGGESTION_MAX_SUBTASKS)
        .describe('Two to five short steps, in order.'),
      confidence,
      reason: z.string(),
    })
    .nullable(),
});

/** The longest reason the card shows (the shared `suggestionFieldsSchema` allows no more). */
export const SUGGESTION_REASON_MAX = 120;
/**
 * A reason that runs long is cut, not refused: one wordy reason must not cost the person
 * every field of an otherwise good proposal.
 */
const reason = z.string().transform((text) => text.slice(0, SUGGESTION_REASON_MAX));
/**
 * The steps as a note can hold them: trimmed, blank and repeated ones dropped, the first
 * `SUGGESTION_MAX_SUBTASKS` kept. A sixth step costs only itself; a step too long for a
 * subtask, or none left at all, drops the steps.
 */
const steps = z
  .array(z.string())
  .transform((items) =>
    [...new Set(items.map((item) => item.trim()).filter(Boolean))].slice(
      0,
      SUGGESTION_MAX_SUBTASKS,
    ),
  )
  .pipe(z.array(z.string().max(SUBTASK_TEXT_MAX_LENGTH)).min(1));
/**
 * What a suggestion must be once it arrives: the wire shape, plus the format and lengths. The
 * date is a real calendar day (`2026-04-31` is refused), the same check the response schema
 * makes, so a record that is stored can always be answered. A date, a priority or a person
 * that does not fit refuses the reply. The title line, the reference and the steps are
 * optional extras: one that does not fit what a note can hold reads as not proposed
 * (`.catch(null)`), so it never costs the person a good date, priority or person beside it.
 */
export const modelSuggestionSchema = z.object({
  dueDate: z.object({ value: z.string().date(), confidence, reason }).nullable(),
  priority: z.object({ value: z.enum(['HOCH', 'NIEDRIG']), confidence, reason }).nullable(),
  assignee: z.object({ memberId: z.string().min(1), confidence, reason }).nullable(),
  title: z
    .object({
      value: z.string().trim().min(1).max(NOTE_TITLE_MAX_LENGTH),
      confidence,
      reason,
    })
    .nullable()
    .catch(null),
  reference: z
    .object({
      key: z.string().trim().min(1).max(FIELD_KEY_MAX_LENGTH),
      value: z.string().trim().min(1).max(FIELD_VALUE_MAX_LENGTH),
      confidence,
      reason,
    })
    .nullable()
    .catch(null),
  subtasks: z.object({ items: steps, confidence, reason }).nullable().catch(null),
});

/**
 * The schema the call sends and the one check its reply gets. The provider is told the wire
 * shape, `maxItems` included; the reply is read with `modelSuggestionSchema` alone, so a model
 * that sends six steps anyway (a JSON tool is not constrained decoding) loses the sixth, not
 * the reply: checked against the wire shape, the library would refuse the whole object.
 */
const replySchema = jsonSchema<z.output<typeof modelSuggestionSchema>>(
  () => zodSchema(modelSuggestionWireSchema).jsonSchema,
  {
    validate: (value) => {
      const checked = modelSuggestionSchema.safeParse(value);
      return checked.success
        ? { success: true, value: checked.data }
        : { success: false, error: checked.error };
    },
  },
);

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
        output: Output.object({ schema: replySchema }),
        maxRetries: 0,
        maxOutputTokens,
        ...(options.providerOptions ? { providerOptions: options.providerOptions } : {}),
        abortSignal: input.abortSignal,
      });
      const usage = toUsage(result.usage);
      if (usage) await lease.settle(usage);
      return {
        fields: result.output,
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
