import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  mcpBoardIdSchema,
  mcpBoardPolicySchema,
  mcpConnectionSchema,
  mcpConnectionsSchema,
  mcpGrantInputSchema,
} from '@wally/shared';
import {
  createConnection,
  connectAccount,
  getBoardPolicy,
  listConnections,
  revokeConnection,
  setBoardPolicy,
} from '../lib/mcp/grants.js';
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
    '/me/connections',
    { schema: { body: mcpGrantInputSchema, response: { 201: mcpConnectionSchema } } },
    async (request, reply) => {
      if (!enabled) throw new AppError(503, 'MCP_DISABLED', 'External AI access is disabled');
      if (!request.user.emailVerified)
        throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email first');
      if (request.body.clientId !== options.clientId)
        throw new AppError(400, 'UNSUPPORTED_CLIENT', 'Unsupported AI client');
      if (request.body.write && !options.writesEnabled)
        throw new AppError(403, 'MCP_WRITES_DISABLED', 'External AI writes are disabled');
      const grant = await createConnection(
        app.db,
        request.user,
        request.body.clientId,
        request.body.boardIds,
        request.body.write,
      );
      return reply.code(201).send(grant);
    },
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
  const params = z.object({ boardId: mcpBoardIdSchema });
  app.get(
    '/whiteboards/:boardId/mcp-access',
    { schema: { params, response: { 200: mcpBoardPolicySchema } } },
    async (request) => getBoardPolicy(app.db, request.user, request.params.boardId),
  );
  app.patch(
    '/whiteboards/:boardId/mcp-access',
    { schema: { params, body: mcpBoardPolicySchema, response: { 200: mcpBoardPolicySchema } } },
    async (request) => {
      if (request.body.enabled && !enabled)
        throw new AppError(503, 'MCP_DISABLED', 'External AI access is disabled');
      if (request.body.enabled && !request.user.emailVerified)
        throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email first');
      return setBoardPolicy(app.db, request.user, request.params.boardId, request.body.enabled);
    },
  );
}
