import type { FastifyInstance } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createAuth0Verifier, type AccessTokenVerifier } from '../lib/auth/auth0.js';
import { resolveIdentity } from '../lib/auth/identities.js';
import { usersCol } from '../lib/db/collections.js';
import { loadEnv } from '../env.js';
import { AppError } from '../lib/errors.js';
import {
  authorizeConnectionBoard,
  authorizeConnectionBoardInTransaction,
  requireConnection,
} from '../lib/mcp/grants.js';
import { availableMcpTools, runMcpTool, type McpToolContext } from '../lib/mcp/tools.js';
import { registerCardViews } from '../lib/mcp/views.js';
import {
  consumeMcpRequestBudget,
  consumeMcpWriteBudget,
  type McpWriteLimits,
} from '../lib/mcp/rate.js';

export const MCP_RESOURCE = 'https://api.wally.luminull.com/mcp';
export const MCP_METADATA_PATH = '/.well-known/oauth-protected-resource/mcp';
function oauthChallenge(resource: string, scopes: string[], needsConsent = false): string {
  return (
    `Bearer resource_metadata="${new URL(resource).origin}${MCP_METADATA_PATH}", scope="${scopes.join(' ')}"` +
    (needsConsent
      ? ', error="insufficient_scope", error_description="Reconnect in Wally Connected apps, then sign in again"'
      : '')
  );
}
export interface McpRouteOptions {
  enabled?: boolean;
  writesEnabled?: boolean;
  clientId?: string;
  verifier?: AccessTokenVerifier;
  writeLimits?: McpWriteLimits;
  requestLimits?: McpWriteLimits;
}

export default async function mcpRoutes(app: FastifyInstance, options: McpRouteOptions) {
  const env = loadEnv();
  const resource = env.MCP_LOCAL_URL ?? MCP_RESOURCE;
  const enabled =
    (options.enabled ?? env.MCP_ENABLED) && (env.AUTH0_ENABLED || Boolean(options.verifier));
  const writesEnabled = options.writesEnabled ?? env.MCP_WRITES_ENABLED;
  const clientId = options.clientId ?? env.MCP_CLIENT_ID;
  const verifier =
    options.verifier ??
    (enabled
      ? createAuth0Verifier({ issuer: env.AUTH0_ISSUER, audience: MCP_RESOURCE })
      : undefined);
  app.get(MCP_METADATA_PATH, { config: { authBoundary: 'public-metadata' } }, async () => ({
    resource,
    authorization_servers: [env.AUTH0_ISSUER],
    scopes_supported: ['wally:read', 'wally:write'],
    bearer_methods_supported: ['header'],
    resource_name: 'Wally boards',
  }));
  app.route({
    method: ['GET', 'POST', 'DELETE'],
    url: '/mcp',
    bodyLimit: 256 * 1024,
    config: { authBoundary: 'mcp', rateLimit: false },
    async handler(request, reply) {
      reply.header('Cache-Control', 'no-store');
      const origin = request.headers.origin;
      if (
        origin &&
        origin !== env.CORS_ORIGIN &&
        origin !== 'https://chatgpt.com' &&
        !(env.MCP_LOCAL_URL && origin === 'http://localhost:6274')
      )
        throw new AppError(403, 'FORBIDDEN', 'Origin is not allowed');
      if (!enabled || !verifier || !clientId)
        throw new AppError(503, 'MCP_DISABLED', 'External AI access is disabled');
      const unauthorized = () =>
        reply
          .header('WWW-Authenticate', oauthChallenge(resource, ['wally:read']))
          .code(401)
          .send({ error: 'UNAUTHORIZED', message: 'A valid MCP access token is required' });
      const bearer = request.headers.authorization?.match(/^Bearer ([^\s]+)$/i)?.[1];
      if (!bearer) return unauthorized();
      let identity;
      try {
        identity = await verifier.verify(bearer);
      } catch {
        return unauthorized();
      }
      if (
        identity.clientId !== clientId ||
        !identity.issuedAt ||
        !identity.scopes?.includes('wally:read')
      )
        return unauthorized();
      const userId = await resolveIdentity(app.db, identity);
      if (!(await usersCol(app.db).doc(userId).get()).exists)
        throw new AppError(403, 'IDENTITY_NOT_LINKED', 'Account migration is required');
      const token = { clientId, issuedAt: identity.issuedAt, scopes: identity.scopes };
      const grant = await requireConnection(app.db, userId, token, identity.emailVerified);
      try {
        await consumeMcpRequestBudget(app.db, userId, grant.id, options.requestLimits);
      } catch (error) {
        if (error instanceof AppError && error.statusCode === 429)
          reply.header('Retry-After', '60');
        throw error;
      }
      if (request.method !== 'POST')
        return reply
          .header('Allow', 'POST')
          .code(405)
          .send({ error: 'METHOD_NOT_ALLOWED', message: 'Use POST for stateless MCP requests' });
      const scopes = grant.scopes.filter((scope) => writesEnabled || scope !== 'wally:write');
      const actor = { id: userId, email: identity.email, emailVerified: identity.emailVerified };
      const context: McpToolContext = {
        db: app.db,
        actor,
        connectionId: grant.id,
        scopes,
        async authorizeWrite(tx, boardId) {
          await authorizeConnectionBoardInTransaction(
            app.db,
            tx,
            actor,
            grant.id,
            boardId,
            true,
            enabled && writesEnabled,
          );
        },
        async authorizeBoard(boardId, write) {
          // Recheck current durable consent for every tool invocation, including replay.
          await requireConnection(app.db, userId, token);
          await authorizeConnectionBoard(
            app.db,
            actor,
            grant.id,
            boardId,
            write,
            enabled && (!write || writesEnabled),
          );
          if (write) await consumeMcpWriteBudget(app.db, userId, grant.id, options.writeLimits);
        },
      };
      const server = new McpServer({ name: 'wally', version: '1.0.0' });
      for (const tool of availableMcpTools(scopes)) {
        const toolScopes = tool.annotations.readOnlyHint
          ? ['wally:read']
          : ['wally:read', 'wally:write'];
        server.registerTool(
          tool.name,
          {
            description: tool.description,
            inputSchema: tool.inputSchema.shape,
            annotations: tool.annotations,
            _meta: { securitySchemes: [{ type: 'oauth2', scopes: toolScopes }] },
          },
          async (args: unknown) => {
            try {
              const result = await runMcpTool(context, tool.name, args);
              return {
                content: [{ type: 'text' as const, text: JSON.stringify(result) }],
                structuredContent: { ...result },
              };
            } catch (error) {
              const result =
                error instanceof AppError
                  ? { error: error.code, message: error.message }
                  : { error: 'INTERNAL_SERVER_ERROR', message: 'Unexpected error' };
              return {
                isError: true,
                ...(error instanceof AppError && error.code === 'MCP_CONSENT_REQUIRED'
                  ? {
                      _meta: {
                        'mcp/www_authenticate': [oauthChallenge(resource, toolScopes, true)],
                      },
                    }
                  : {}),
                content: [{ type: 'text' as const, text: JSON.stringify(result) }],
                structuredContent: result,
              };
            }
          },
        );
      }
      registerCardViews(server, context, env.CORS_ORIGIN);
      const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
      try {
        await server.connect(transport);
        const headers = new Headers();
        for (const [name, value] of Object.entries(request.headers)) {
          if (typeof value === 'string') headers.set(name, value);
          else if (Array.isArray(value)) headers.set(name, value.join(', '));
        }
        const response = await transport.handleRequest(
          new Request(resource, { method: 'POST', headers }),
          { parsedBody: request.body },
        );
        reply.code(response.status);
        response.headers.forEach((value, name) => reply.header(name, value));
        const text = await response.text();
        if (
          response.status === 200 &&
          request.body &&
          typeof request.body === 'object' &&
          'method' in request.body &&
          request.body.method === 'tools/list'
        ) {
          // SDK v1 preserves extension metadata but lacks top-level securitySchemes.
          // ChatGPT expects the declaration at both locations; mirror SDK-generated
          // descriptors without changing authentication or tool execution.
          const payload = JSON.parse(text) as {
            result?: {
              tools?: { securitySchemes?: unknown; _meta?: { securitySchemes?: unknown } }[];
            };
          };
          for (const tool of payload.result?.tools ?? [])
            tool.securitySchemes = tool._meta?.securitySchemes;
          return reply.send(payload);
        }
        return reply.send(text);
      } finally {
        await server.close();
      }
    },
  });
}
