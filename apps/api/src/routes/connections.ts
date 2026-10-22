import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { mcpConnectionSchema, mcpConnectionsSchema } from '@wally/shared';
import { connectAccount, listConnections, revokeConnection } from '../lib/mcp/grants.js';
import { AppError } from '../lib/errors.js';

export interface ConnectionRouteOptions {
  enabled: boolean;
  writesEnabled: boolean;
  clientId?: string;
}
export default async function connectionRoutes(
  fastify: FastifyInstance,
  options: ConnectionRouteOptions,
) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const enabled = options.enabled && Boolean(options.clientId);
  app.get(
    '/me/connections',
    { schema: { response: { 200: mcpConnectionsSchema } } },
    async (request) => ({
      enabled,
      writesEnabled: enabled && options.writesEnabled,
      client: options.clientId ? { id: options.clientId, name: 'ChatGPT' } : null,
      connections: await listConnections(app.db, request.user.id),
    }),
  );
  app.post(
    '/me/connections/connect',
    {
      schema: {
        body: z.object({ clientId: z.string().min(1).max(200) }).strict(),
        response: { 200: mcpConnectionSchema },
      },
    },
    async (request) => {
      if (!enabled) throw new AppError(503, 'MCP_DISABLED', 'External AI access is disabled');
      if (!request.user.emailVerified)
        throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email first');
      if (request.body.clientId !== options.clientId)
        throw new AppError(400, 'UNSUPPORTED_CLIENT', 'Unsupported AI client');
      return connectAccount(app.db, request.user.id, request.body.clientId);
    },
  );
  app.delete(
    '/me/connections/:connectionId',
    { schema: { params: z.object({ connectionId: z.string().uuid() }) } },
    async (request, reply) => {
      await revokeConnection(app.db, request.user.id, request.params.connectionId);
      return reply.code(204).send();
    },
  );
}
