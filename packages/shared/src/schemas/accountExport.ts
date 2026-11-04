import { z } from 'zod';
import { assistantConversationDtoSchema } from './assistant.js';
import { whiteboardSummaryDtoSchema } from './board.js';
import { meDtoSchema } from './me.js';
import { mcpConnectionSchema } from './mcp.js';
import { memberDtoSchema } from './member.js';
import { noteDetailDtoSchema } from './note.js';
import { tidyDtoSchema } from './tidy.js';

/**
 * Everything an account can see in Wally, as GET /me/export returns it (GDPR Art. 15 and 20).
 * Built from the same DTOs the app shows, so other people's private notes never appear.
 */
export const accountExportSchema = z.object({
  formatVersion: z.literal(1),
  exportedAt: z.string().datetime(),
  profile: meDtoSchema,
  boards: z.array(
    whiteboardSummaryDtoSchema.extend({
      members: z.array(memberDtoSchema),
      notes: z.array(noteDetailDtoSchema),
    }),
  ),
  connections: z.array(mcpConnectionSchema),
  assistant: z.object({
    usage: z.array(z.object({ day: z.string(), tokens: z.number() })),
    conversations: z.array(assistantConversationDtoSchema),
    suggestions: z.array(
      z.object({
        id: z.string(),
        boardId: z.string(),
        noteId: z.string(),
        status: z.string(),
        fields: z.unknown(),
        createdAt: z.string().datetime(),
      }),
    ),
    tidies: z.array(tidyDtoSchema),
  }),
});
export type AccountExport = z.infer<typeof accountExportSchema>;
