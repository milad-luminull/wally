import { z } from 'zod';
import { isTimeZone } from '../utils/timeZone.js';
import { assistantChipSchema } from './assistant.js';

/**
 * The Wally box's intake (docs/superpowers/specs/2026-11-08-wally-box-design.md §4): one model
 * call reads what was typed and says what it holds, so nothing is decided by keyword rules.
 */
export const INTAKE_MAX_NOTES = 10;
export const INTAKE_MESSAGE_MAX = 2000;

const text = z.string().trim().min(1).max(INTAKE_MESSAGE_MAX);

/** POST /whiteboards/:id/assistant/intakes. `context` is the answer showing in the box. */
export const intakeRequestSchema = z
  .object({
    // A NUL is refused before a model call is reserved, as for a question.
    message: text.refine((value) => !value.includes('\u0000'), 'Invalid character'),
    context: z
      .object({ question: z.string().max(2000), answer: z.string().max(4000) })
      .strict()
      .optional(),
    timeZone: z.string().min(1).max(64).refine(isTimeZone, 'Unknown time zone'),
    today: z.string().date(),
  })
  .strict();
export type IntakeRequest = z.infer<typeof intakeRequestSchema>;

/** One answer to a question back: what it does, and the words it does it with. */
export const intakeOptionSchema = z.object({
  label: z.string().min(1).max(80),
  action: z.enum(['note', 'ask']),
  text,
});
export type IntakeOption = z.infer<typeof intakeOptionSchema>;

export const intakeItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('note'), text }),
  z.object({ kind: z.literal('ask'), text }),
  /** A note already on the wall, by meaning: the box asks before adding it again. */
  z.object({ kind: z.literal('duplicate'), text, note: assistantChipSchema }),
  /** Too vague to act on: one short question and two or three ways to go on. */
  z.object({
    kind: z.literal('clarify'),
    question: z.string().min(1).max(300),
    options: z.array(intakeOptionSchema).min(2).max(3),
  }),
]);
export type IntakeItem = z.infer<typeof intakeItemSchema>;

/** `truncated` says notes past `INTAKE_MAX_NOTES` were left out. */
export const intakeResponseSchema = z.object({
  items: z.array(intakeItemSchema).min(1),
  truncated: z.boolean(),
});
export type IntakeResponse = z.infer<typeof intakeResponseSchema>;
