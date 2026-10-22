import { z } from 'zod';

export const mcpScopeSchema = z.enum(['wally:read', 'wally:write']);
export const mcpConnectionSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string(),
  name: z.string(),
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
export type McpConnections = z.infer<typeof mcpConnectionsSchema>;
