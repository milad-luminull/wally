import { z } from 'zod';

export const assistantTurnRequestSchema = z
  .object({
    conversationId: z.string().min(1).max(128).optional(),
    message: z.string().trim().min(1).max(2000),
    timeZone: z.string().min(1).max(64),
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
