import { z } from 'zod';

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
