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
  NOTE_DESCRIPTION_MAX_LENGTH,
  NOTE_TITLE_MAX_LENGTH,
  SUBTASK_TEXT_MAX_LENGTH,
  SUGGESTION_MAX_LINKS,
  SUGGESTION_MAX_PROPERTIES,
  SUGGESTION_MAX_SUBTASKS,
  SUGGESTION_MAX_TAGS,
  TAG_MAX_LENGTH,
  foldFieldKey,
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
      value: z.string().describe('A shorter title with the same meaning.'),
      confidence,
      reason: z.string(),
    })
    .describe('A cleaner title, or null.')
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
  links: z
    .object({
      items: z
        .array(z.object({ noteId: z.string(), reason: z.string() }))
        .max(SUGGESTION_MAX_LINKS)
        .describe('One to three other notes from the list, by id, each with why.'),
      confidence,
      reason: z.string(),
    })
    .nullable(),
  horizon: z
    .object({
      value: z.enum(['DIESE_WOCHE', 'SPAETER']).describe('This week, or Later.'),
      confidence,
      reason: z.string(),
    })
    .nullable(),
  visibility: z.object({ value: z.enum(['PRIVATE']), confidence, reason: z.string() }).nullable(),
  tags: z
    .object({
      items: z
        .array(z.string())
        .max(SUGGESTION_MAX_TAGS)
        .describe("Up to three tags, the board's own where they fit."),
      confidence,
      reason: z.string(),
    })
    .nullable(),
  properties: z
    .object({
      items: z
        .array(z.object({ key: z.string(), value: z.string() }))
        .max(SUGGESTION_MAX_PROPERTIES)
        .describe("Up to three properties, reusing the board's keys when they fit."),
      confidence,
      reason: z.string(),
    })
    .nullable(),
  description: z
    .object({
      value: z.string().describe('The detail of a long title, moved out of it.'),
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
 * The related notes as the record keeps them: ids trimmed, blank and repeated ones dropped,
 * each reason cut like any other, the first `SUGGESTION_MAX_LINKS` kept. Whether an id is one
 * of the rows the model was shown is the service's check; none left drops the links.
 */
const linkItems = z
  .array(z.object({ noteId: z.string(), reason: z.string() }))
  .transform((items) => {
    const seen = new Set<string>();
    const out: { noteId: string; reason: string }[] = [];
    for (const item of items) {
      const noteId = item.noteId.trim();
      if (!noteId || seen.has(noteId)) continue;
      seen.add(noteId);
      out.push({ noteId, reason: item.reason.slice(0, SUGGESTION_REASON_MAX) });
    }
    return out.slice(0, SUGGESTION_MAX_LINKS);
  })
  .pipe(z.array(z.object({ noteId: z.string().min(1), reason: z.string() })).min(1));
/**
 * Tags as a note holds them: trimmed, blank ones and repeats (by the locale-neutral fold, the
 * first spelling kept) dropped, the first three kept. One too long for a tag drops the tags.
 */
const tagItems = z
  .array(z.string())
  .transform((items) => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of items) {
      const tag = raw.trim();
      if (!tag || seen.has(foldFieldKey(tag))) continue;
      seen.add(foldFieldKey(tag));
      out.push(tag);
    }
    return out.slice(0, SUGGESTION_MAX_TAGS);
  })
  .pipe(z.array(z.string().max(TAG_MAX_LENGTH)).min(1));
/**
 * Properties as a note holds them: key and value trimmed, an item with either blank dropped,
 * a key named twice (by the fold) kept once, the first three kept. One that does not fit a
 * property drops the properties.
 */
const propertyItems = z
  .array(z.object({ key: z.string(), value: z.string() }))
  .transform((items) => {
    const seen = new Set<string>();
    const out: { key: string; value: string }[] = [];
    for (const item of items) {
      const key = item.key.trim();
      const value = item.value.trim();
      if (!key || !value || seen.has(foldFieldKey(key))) continue;
      seen.add(foldFieldKey(key));
      out.push({ key, value });
    }
    return out.slice(0, SUGGESTION_MAX_PROPERTIES);
  })
  .pipe(
    z
      .array(
        z.object({
          key: z.string().max(FIELD_KEY_MAX_LENGTH),
          value: z.string().max(FIELD_VALUE_MAX_LENGTH),
        }),
      )
      .min(1),
  );
/**
 * What a suggestion must be once it arrives: the wire shape, plus the format and lengths. The
 * date is a real calendar day (`2026-04-31` is refused), the same check the response schema
 * makes, so a record that is stored can always be answered. A date, a priority or a person
 * that does not fit refuses the reply. The title line, the steps, the links and the smarter
 * capture's fields are optional extras: one that does not fit what a note can hold reads as not proposed
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
  subtasks: z.object({ items: steps, confidence, reason }).nullable().catch(null),
  links: z.object({ items: linkItems, confidence, reason }).nullable().catch(null),
  horizon: z
    .object({ value: z.enum(['DIESE_WOCHE', 'SPAETER']), confidence, reason })
    .nullable()
    .catch(null),
  visibility: z
    .object({ value: z.literal('PRIVATE'), confidence, reason })
    .nullable()
    .catch(null),
  tags: z.object({ items: tagItems, confidence, reason }).nullable().catch(null),
  properties: z.object({ items: propertyItems, confidence, reason }).nullable().catch(null),
  description: z
    .object({
      value: z.string().trim().min(1).max(NOTE_DESCRIPTION_MAX_LENGTH),
      confidence,
      reason,
    })
    .nullable()
    .catch(null),
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
/** What a call the provider refused with an error status costs: nothing. */
const NOTHING_BILLED = {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
};

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
      // No usage reported: the reservation stays charged, the slot is freed (R7).
      if (usage) await lease.settle(usage);
      else await lease.release();
      return {
        fields: result.output,
        usage,
        finishReason: result.finishReason,
      };
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        const usage = error.usage ? toUsage(error.usage) : null;
        if (usage) await lease.settle(usage);
        else await lease.release();
        return { fields: null, usage, finishReason: error.finishReason ?? 'other' };
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
