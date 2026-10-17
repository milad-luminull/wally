import { z } from 'zod';
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

/** The fields Wallybot may fill in on a note written in place (WALLYBOT_INLINE.md §3.3, R1). */
export const suggestionFieldKeys = ['dueDate', 'priority', 'assignee'] as const;
export const suggestionFieldKeySchema = z.enum(suggestionFieldKeys);
export type SuggestionFieldKey = z.infer<typeof suggestionFieldKeySchema>;

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
  /** After a keep: which fields were applied and the revision they produced. */
  kept: z
    .object({ fields: z.array(suggestionFieldKeySchema), revision: z.number().int().nonnegative() })
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
    source: suggestionDecisionSourceSchema,
  })
  .strict();
export type SuggestionDecision = z.infer<typeof suggestionDecisionSchema>;
export const suggestionDecisionResponseSchema = z.object({ suggestion: suggestionDtoSchema });
