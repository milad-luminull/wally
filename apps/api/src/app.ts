import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Firestore } from 'firebase-admin/firestore';
import { loadEnv } from './env.js';
import firestorePlugin from './plugins/firestore.js';
import firebasePlugin, { type AuthVerifier } from './plugins/firebase.js';
import authPlugin, { type AuthenticatedUser } from './plugins/auth.js';
import connectionRoutes, { type ConnectionRouteOptions } from './routes/connections.js';
import mcpRoutes, { type McpRouteOptions } from './routes/mcp.js';
import assistantRoutes from './routes/assistant.js';
import boardRoutes from './routes/boards.js';
import healthRoutes from './routes/health.js';
import meRoutes from './routes/me.js';
import type { SuggestionRunner, TidyRunner, TurnRunner } from './lib/assistant/model/index.js';
import { AppError } from './lib/errors.js';
import { createAuth0Verifier, type AccessTokenVerifier } from './lib/auth/auth0.js';
import { errorReplyFor } from './lib/errorBody.js';

export interface BuildAppOptions {
  /** Overrides the shared Firestore client — tests pass one scoped to their own project. */
  db?: Firestore;
  /** Overrides Firebase token verification — tests pass a fake to avoid real tokens. */
  authVerifier?: AuthVerifier;
  /** Auth0 access-token verification seam; production remains opt-in. */
  auth0Verifier?: AccessTokenVerifier;
  auth0SignupEnabled?: boolean;
  /** MCP-specific test overrides; never reuses the REST audience verifier. */
  mcp?: McpRouteOptions;
  connections?: ConnectionRouteOptions;
  logger?: boolean;
  /** Where log lines go instead of stdout: the tests read them. Implies `logger`. */
  logStream?: { write: (line: string) => void };
  /** Overrides the model runner — tests pass a fake so no model is called. */
  assistantRunner?: TurnRunner;
  /** Overrides the capture suggestion runner — tests pass a fake so no model is called. */
  suggestionRunner?: SuggestionRunner;
  /** Overrides the tidy runner — tests pass a fake so no model is called. */
  tidyRunner?: TidyRunner;
  /** Overrides the deployment switch for tests (the env is cached per process). */
  assistantEnabled?: boolean;
  /** Overrides the turn deadline for tests. */
  assistantDeadlineMs?: number;
}

/**
 * What a request log line may say about a request: its method and path, nothing else. Fastify's
 * default request serializer also writes the client's address, port and host header; an IP
 * address is personal data, and the request log has no use for it (GDPR.md, GAP-05). The query
 * string is dropped and share-link tokens are redacted, since either can grant or reveal access.
 */
export const requestLogSerializers = {
  req: (request: { method: string; url: string }) => ({
    method: request.method,
    url: request.url.split('?')[0]!.replace(/(\/share-links\/)[^/?]+/g, '$1[redacted]'),
  }),
};

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = loadEnv();

  const app = Fastify({
    logger: options.logStream
      ? { serializers: requestLogSerializers, stream: options.logStream }
      : (options.logger ?? env.NODE_ENV !== 'test')
        ? { serializers: requestLogSerializers }
        : false,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // One body for every error (the error handling spec, 2026-10-19): see errorReplyFor.
  app.setErrorHandler((err, request, reply) => {
    const { status, body } = errorReplyFor(err);
    if (status >= 500)
      request.log.error(
        { code: (err as { code?: unknown }).code, name: (err as Error).name, error: body.error },
        'Request failed',
      );
    // A refusal from the assistant is logged by its code alone: "nothing came" is then never
    // a mystery in production. The words of the request never reach the log.
    else if (request.url.includes('/assistant/'))
      request.log.warn({
        type: 'request.refused',
        code: body.error,
        status,
        route: request.routeOptions.url,
      });
    return reply.code(status).send(body);
  });
  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: 'NOT_FOUND', message: 'Not found', retryable: false }),
  );

  await app.register(cors, {
    origin: env.CORS_ORIGIN,
    // @fastify/cors 11 narrowed the default to the CORS-safelisted GET/HEAD/POST, which would
    // fail the browser's preflight for every PATCH and DELETE route. Name them explicitly.
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'Accept',
      'Accept-Language',
      'Idempotency-Key',
      'X-Expected-Revision',
      'MCP-Protocol-Version',
    ],
    exposedHeaders: ['X-Resource-Revision', 'WWW-Authenticate'],
  });

  await app.register(firestorePlugin, { db: options.db });
  await app.register(firebasePlugin, { verifier: options.authVerifier });
  await app.register(authPlugin, {
    auth0Verifier:
      options.auth0Verifier ??
      (env.AUTH0_ENABLED
        ? createAuth0Verifier({ issuer: env.AUTH0_ISSUER, audience: env.AUTH0_AUDIENCE })
        : undefined),
    auth0Issuer: env.AUTH0_ISSUER,
    auth0SignupEnabled: options.auth0SignupEnabled ?? env.AUTH0_SIGNUP_ENABLED,
  });

  /**
   * Registered AFTER the auth plugin and hooked into `preHandler` rather than the default
   * `onRequest`, so `request.user` already exists and each caller gets their own budget.
   * Keying on the IP instead would put a whole office behind one NAT in a single bucket —
   * and behind Cloud Run, without a `trustProxy` hop count, it would put EVERY caller in
   * one bucket and throttle them collectively.
   *
   * The trade-off is that requests failing auth short-circuit before this runs, so they
   * are not counted. The only route reachable without a token is /health, and share tokens
   * are 24 random bytes, so there is nothing here worth brute-forcing.
   *
   * The store is in-process, so on Cloud Run the effective limit is per instance. That is
   * a deliberate floor rather than a precise cap — a shared store would mean running Redis,
   * which this stack deliberately does not have.
   */
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    hook: 'preHandler',
    keyGenerator: (request) => (request.user as AuthenticatedUser | undefined)?.id ?? request.ip,
    // An AppError, not a plain object: the plugin hands this to setErrorHandler, which
    // reads statusCode/code off it. A bare object has neither, so it fell through to the
    // 500 branch and reported a rate limit as a server fault.
    // English and machine-ish, like every other message the API sends. A 429 can be raised
    // before request.user exists (the keyGenerator falls back to request.ip for exactly that
    // reason), so there is no reliable language to render in here anyway. The stable
    // RATE_LIMITED code is the contract; the copy belongs to the client.
    errorResponseBuilder: () => new AppError(429, 'RATE_LIMITED', 'Too many requests'),
  });

  await app.register(mcpRoutes, {
    ...options.mcp,
    assistantEnabled: options.mcp?.assistantEnabled ?? options.assistantEnabled,
  });
  await app.register(
    connectionRoutes,
    options.connections ?? {
      enabled:
        env.MCP_ENABLED && (options.assistantEnabled ?? env.ASSISTANT_ENABLED) && env.AUTH0_ENABLED,
      writesEnabled: env.MCP_WRITES_ENABLED,
      clientId: env.MCP_CLIENT_ID,
    },
  );
  await app.register(healthRoutes);
  await app.register(meRoutes);
  await app.register(boardRoutes);
  await app.register(assistantRoutes, {
    runner: options.assistantRunner,
    suggestionRunner: options.suggestionRunner,
    tidyRunner: options.tidyRunner,
    enabled: options.assistantEnabled,
    deadlineMs: options.assistantDeadlineMs,
  });

  return app;
}
