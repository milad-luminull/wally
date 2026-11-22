import { jsonSchema, zodSchema, type LanguageModel } from 'ai';
import { z } from 'zod';
import type { Env } from '../../../env.js';
import {
  parseModelRef,
  resolveLanguageModel,
  suggestionCallSettings,
  type SuggestionCallSettings,
} from './config.js';
import { createStructuredRunner } from './structured.js';
import type { IntakeInput, IntakeOutput, IntakeRunner, ModelIntakeItem } from './types.js';

/** Items a reply may carry: room for the box's ten notes and one other item, and some slack. */
export const INTAKE_WIRE_MAX_ITEMS = 20;

const kind = z.enum(['note', 'ask', 'duplicate']);
const action = z.enum(['note', 'ask']);
/**
 * What the model is asked for. Flat, every field present: only the keywords Gemini's
 * structured-output page documents reach the provider, so no unions (see
 * `modelSuggestionWireSchema`). Source: https://ai.google.dev/gemini-api/docs/structured-output
 * (read 2026-10-17). The question back is its own field, not an item: Vertex answers 400
 * INVALID_ARGUMENT to an array of objects inside an array of objects (seen 2026-11-08). The
 * lengths and the kinds' rules are checked by `acceptIntake`.
 */
export const modelIntakeWireSchema = z.object({
  items: z
    .array(
      z.object({
        kind,
        text: z.string().describe('The note or the question in the writer’s words.'),
        noteId: z
          .string()
          .describe('For duplicate: the id of the open note it matches; else empty.'),
      }),
    )
    .max(INTAKE_WIRE_MAX_ITEMS)
    .describe('The notes, questions and duplicates the message holds, in order.'),
  clarify: z
    .object({
      question: z.string().describe('One short question.'),
      options: z
        .array(z.object({ label: z.string(), action, text: z.string() }))
        .max(3)
        .describe('Two or three ways to go on.'),
    })
    .nullable()
    .describe('Only when the words are too vague to act on; else null.'),
});

const option = z.object({ label: z.string(), action, text: z.string() });
const item = z.object({
  kind,
  text: z.string().default(''),
  noteId: z.string().default(''),
});
const clarify = z.object({
  question: z.string().default(''),
  options: z
    .array(z.unknown())
    .default([])
    .transform((list) =>
      list.flatMap((entry) => {
        const parsed = option.safeParse(entry);
        return parsed.success ? [parsed.data] : [];
      }),
    ),
});
/**
 * A reply once it arrives, as one list: the items in order, then the question back. An item
 * that does not fit drops alone, as a tidy's move does.
 */
export const modelIntakeSchema = z
  .object({
    items: z.array(z.unknown()).default([]),
    clarify: z.unknown().optional(),
  })
  .transform(({ items, clarify: raw }) => {
    const list = items.flatMap((entry): ModelIntakeItem[] => {
      const parsed = item.safeParse(entry);
      return parsed.success ? [{ ...parsed.data, question: '', options: [] }] : [];
    });
    const back = raw ? clarify.safeParse(raw) : null;
    if (back?.success) list.push({ kind: 'clarify', text: '', noteId: '', ...back.data });
    return { items: list };
  });

const replySchema = jsonSchema<z.output<typeof modelIntakeSchema>>(
  () => zodSchema(modelIntakeWireSchema).jsonSchema,
  {
    validate: (value) => {
      const checked = modelIntakeSchema.safeParse(value);
      return checked.success
        ? { success: true, value: checked.data }
        : { success: false, error: checked.error };
    },
  },
);

export function createIntakeRunner(
  model: LanguageModel,
  options: Partial<SuggestionCallSettings> = {},
): IntakeRunner {
  const run = createStructuredRunner(model, replySchema, options);
  return async (input: IntakeInput): Promise<IntakeOutput> => {
    const { output, usage, finishReason } = await run(input);
    return { items: output?.items ?? null, usage, finishReason };
  };
}

let schemaJson: Promise<string> | null = null;
/** The response schema as the library sends it, serialised, so the reservation counts it. */
export function intakeSchemaJson(): Promise<string> {
  schemaJson ??= Promise.resolve(zodSchema(modelIntakeWireSchema).jsonSchema).then((schema) =>
    JSON.stringify(schema),
  );
  return schemaJson;
}

/** The runner for the deployment's configured model, with a capture's call settings. */
export function createConfiguredIntakeRunner(
  env: Pick<Env, 'ASSISTANT_MODEL' | 'ASSISTANT_VERTEX_LOCATION' | 'ASSISTANT_VERTEX_PROJECT'>,
): IntakeRunner {
  const ref = parseModelRef(env.ASSISTANT_MODEL);
  return createIntakeRunner(resolveLanguageModel(ref, env), suggestionCallSettings(ref));
}
