import { z } from 'zod';
import {
  FIELD_KEY_MAX_LENGTH,
  FIELD_VALUE_MAX_LENGTH,
  NOTE_TITLE_MAX_LENGTH,
  SUBTASK_TEXT_MAX_LENGTH,
} from '../constants.js';
import { userSummarySchema } from './user.js';

/** An IANA zone the runtime knows; anything else would fail later, when the prompt is built. */
function isTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

export const assistantTurnRequestSchema = z
  .object({
    // A Firestore document id, as the API creates them; the pattern me.ts uses for ids.
    conversationId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,128}$/, 'Invalid conversation id')
      .optional(),
    message: z.string().trim().min(1).max(2000),
    timeZone: z.string().min(1).max(64).refine(isTimeZone, 'Unknown time zone'),
    today: z.string().date(),
  })
  .strict();
export type AssistantTurnRequest = z.infer<typeof assistantTurnRequestSchema>;

export const assistantChipSchema = z.object({ id: z.string(), title: z.string() });
export type AssistantChip = z.infer<typeof assistantChipSchema>;

export const assistantEntrySchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  chips: z.array(assistantChipSchema),
  /** True when a read the answer relied on was truncated. */
  partial: z.boolean(),
  stopped: z.enum(['TOOL_LIMIT', 'TIMEOUT', 'LENGTH']).nullable(),
  at: z.string().datetime(),
});
export type AssistantEntry = z.infer<typeof assistantEntrySchema>;

export const assistantConversationDtoSchema = z.object({
  id: z.string(),
  boardId: z.string(),
  status: z.enum(['OPEN', 'CLOSED']),
  model: z.string(),
  entries: z.array(assistantEntrySchema),
});
export type AssistantConversationDto = z.infer<typeof assistantConversationDtoSchema>;

export const assistantTurnResponseSchema = z.object({
  conversation: assistantConversationDtoSchema,
});
export type AssistantTurnResponse = z.infer<typeof assistantTurnResponseSchema>;

/**
 * The fields Wallybot may fill in on a note written in place: slice 2's three, and slice 3's
 * title line, reference property and subtasks (WALLYBOT_INLINE.md §3.3, §3.4).
 */
export const suggestionFieldKeys = [
  'dueDate',
  'priority',
  'assignee',
  'title',
  'reference',
  'subtasks',
  'links',
] as const;
export const suggestionFieldKeySchema = z.enum(suggestionFieldKeys);
export type SuggestionFieldKey = z.infer<typeof suggestionFieldKeySchema>;
/** Steps a proposal may carry; more would be a plan, not a note. */
export const SUGGESTION_MAX_SUBTASKS = 5;
/** Related notes a proposal may name; more would be a map of the board, not a note. */
export const SUGGESTION_MAX_LINKS = 3;

const firestoreId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, 'Invalid id');

/**
 * POST /whiteboards/:id/assistant/captures. `locked` names the fields the person decided
 * while writing (a kept chip, a placement on the priority wall); they are never proposed.
 */
export const captureSuggestRequestSchema = z
  .object({
    noteId: firestoreId,
    locked: z.array(suggestionFieldKeySchema).max(suggestionFieldKeys.length).default([]),
    timeZone: z.string().min(1).max(64).refine(isTimeZone, 'Unknown time zone'),
    today: z.string().date(),
  })
  .strict();
export type CaptureSuggestRequest = z.infer<typeof captureSuggestRequestSchema>;

/** A short reason in the person's language, shown with the field (the brief's "why"). */
const reasonSchema = z.string().max(120);

export const suggestionFieldsSchema = z.object({
  dueDate: z.object({ value: z.string().date(), reason: reasonSchema }).nullable(),
  priority: z.object({ value: z.enum(['HOCH', 'NIEDRIG']), reason: reasonSchema }).nullable(),
  assignee: z.object({ value: userSummarySchema, reason: reasonSchema }).nullable(),
  /** A cleaner title, offered beside the person's own and never applied by a countdown (R2). */
  title: z
    .object({ value: z.string().min(1).max(NOTE_TITLE_MAX_LENGTH), reason: reasonSchema })
    .nullable(),
  /** One property, "Customer: Müller GmbH"; the key is one the board already uses when it fits (R7). */
  reference: z
    .object({
      key: z.string().min(1).max(FIELD_KEY_MAX_LENGTH),
      value: z.string().min(1).max(FIELD_VALUE_MAX_LENGTH),
      reason: reasonSchema,
    })
    .nullable(),
  /**
   * One step or more, at most `SUGGESTION_MAX_SUBTASKS`: the server proposes two to five (a
   * single step is no breakdown), and the person keeps them one by one in the review.
   */
  subtasks: z
    .object({
      items: z
        .array(z.string().min(1).max(SUBTASK_TEXT_MAX_LENGTH))
        .min(1)
        .max(SUGGESTION_MAX_SUBTASKS),
      reason: reasonSchema,
    })
    .nullable(),
  /**
   * Related notes on the board, one to three, each with the words that relate them (§3.4); the
   * title is the target's current one, read when the record is read (the plan's L3).
   */
  links: z
    .object({
      items: z
        .array(
          z.object({
            /** The item's index in the stored proposal: what a keep names, even when others dropped out. */
            index: z.number().int().nonnegative(),
            noteId: z.string(),
            title: z.string(),
            reason: reasonSchema,
          }),
        )
        .min(1)
        .max(SUGGESTION_MAX_LINKS),
      reason: reasonSchema,
    })
    .nullable(),
});
export type SuggestionFields = z.infer<typeof suggestionFieldsSchema>;

export const suggestionStatusSchema = z.enum(['PENDING', 'KEPT', 'UNDONE', 'DISCARDED']);
export type SuggestionStatus = z.infer<typeof suggestionStatusSchema>;

export const suggestionDtoSchema = z.object({
  id: z.string(),
  boardId: z.string(),
  noteId: z.string(),
  status: suggestionStatusSchema,
  /** The note revision the proposal was computed against; a keep is refused past it. */
  baseRevision: z.number().int().nonnegative(),
  fields: suggestionFieldsSchema,
  /** The fields the person decided while writing (the chips, the placement): the review's first group. */
  typed: z.array(suggestionFieldKeySchema),
  /** After a keep: which fields were applied and the revision they produced. */
  kept: z
    .object({
      fields: z.array(suggestionFieldKeySchema),
      /** Which of the proposed subtasks were written, by index. */
      subtasks: z.array(z.number().int().nonnegative()),
      /** Which of the proposed links were written, by index. */
      links: z.array(z.number().int().nonnegative()),
      revision: z.number().int().nonnegative(),
    })
    .nullable(),
  createdAt: z.string().datetime(),
});
export type SuggestionDto = z.infer<typeof suggestionDtoSchema>;

export const captureSuggestResponseSchema = z.object({
  suggestion: suggestionDtoSchema.nullable(),
});
export type CaptureSuggestResponse = z.infer<typeof captureSuggestResponseSchema>;

export const suggestionListSchema = z.object({ suggestions: z.array(suggestionDtoSchema) });
export type SuggestionList = z.infer<typeof suggestionListSchema>;

/** How the decision reached the server, stored with it (WALLYBOT_INLINE.md §4). */
export const suggestionDecisionSourceSchema = z.enum([
  'enter',
  'countdown',
  'esc',
  'remove',
  'shortcut',
  'click',
]);
export const suggestionDecisionSchema = z
  .object({
    decision: z.enum(['keep', 'discard', 'undo']),
    /** For `keep`: the fields still on the card; omitted means every proposed field. */
    fields: z.array(suggestionFieldKeySchema).max(suggestionFieldKeys.length).optional(),
    /** For `keep` with `subtasks` among the fields: the items to write, by index; omitted means all. */
    subtasks: z
      .array(
        z
          .number()
          .int()
          .min(0)
          .max(SUGGESTION_MAX_SUBTASKS - 1),
      )
      .max(SUGGESTION_MAX_SUBTASKS)
      .optional(),
    /** For `keep` with `links` among the fields: the items to write, by index; omitted means all. */
    links: z
      .array(
        z
          .number()
          .int()
          .min(0)
          .max(SUGGESTION_MAX_LINKS - 1),
      )
      .max(SUGGESTION_MAX_LINKS)
      .optional(),
    source: suggestionDecisionSourceSchema,
  })
  .strict();
export type SuggestionDecision = z.infer<typeof suggestionDecisionSchema>;
export const suggestionDecisionResponseSchema = z.object({ suggestion: suggestionDtoSchema });
