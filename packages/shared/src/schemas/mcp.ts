import { z } from 'zod';

export const mcpScopeSchema = z.enum(['wally:read', 'wally:write']);
export const mcpBoardIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[^/]+$/);
export const mcpGrantInputSchema = z
  .object({
    clientId: z.string().min(1).max(200),
    boardIds: z.array(mcpBoardIdSchema).min(1).max(50),
    write: z.boolean().default(false),
  })
  .strict();
export const mcpConnectionSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string(),
  name: z.string(),
  boardIds: z.array(mcpBoardIdSchema),
  scopes: z.array(mcpScopeSchema),
  createdAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
});
export const mcpConnectionsSchema = z.object({
  enabled: z.boolean(),
  writesEnabled: z.boolean(),
  client: z.object({ id: z.string(), name: z.string() }).nullable(),
  connections: z.array(mcpConnectionSchema),
});
export const mcpBoardPolicySchema = z.object({ enabled: z.boolean() }).strict();
export type McpConnections = z.infer<typeof mcpConnectionsSchema>;
