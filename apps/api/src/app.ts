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
import healthRoutes from './routes/health.js';
import meRoutes from './routes/me.js';
import whiteboardRoutes from './routes/whiteboards.js';
import noteRoutes from './routes/notes.js';
import subtaskRoutes from './routes/subtasks.js';
import memberRoutes from './routes/members.js';
import shareLinkRoutes from './routes/share-links.js';
import { AppError } from './lib/errors.js';

/** gRPC status code Firestore raises when updating or reading a document that isn't there. */
const GRPC_NOT_FOUND = 5;

export interface BuildAppOptions {
  /** Overrides the shared Firestore client — tests pass one scoped to their own project. */
  db?: Firestore;
  /** Overrides Firebase token verification — tests pass a fake to avoid real tokens. */
  authVerifier?: AuthVerifier;
  logger?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = loadEnv();

  const app = Fastify({
    logger: options.logger ?? env.NODE_ENV !== 'test',
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler((err, request, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message });
    }
    // An update against a document that has since been deleted surfaces as a gRPC
    // NOT_FOUND rather than an HTTP-shaped error, so translate it here.
    if ((err as { code?: unknown }).code === GRPC_NOT_FOUND) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Not found' });
    }
    const statusCode =
      typeof (err as { statusCode?: unknown }).statusCode === 'number'
        ? (err as { statusCode: number }).statusCode
        : 500;
    if (statusCode >= 500) request.log.error(err);
    return reply.code(statusCode).send({
      error: statusCode === 500 ? 'INTERNAL_SERVER_ERROR' : 'BAD_REQUEST',
      message: statusCode === 500 ? 'Unexpected error' : (err as Error).message,
    });
  });

  await app.register(cors, {
    origin: env.CORS_ORIGIN,
  });

  await app.register(firestorePlugin, { db: options.db });
  await app.register(firebasePlugin, { verifier: options.authVerifier });
  await app.register(authPlugin);

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
    keyGenerator: (request) =>
      (request.user as AuthenticatedUser | undefined)?.id ?? request.ip,
    // An AppError, not a plain object: the plugin hands this to setErrorHandler, which
    // reads statusCode/code off it. A bare object has neither, so it fell through to the
    // 500 branch and reported a rate limit as a server fault.
    // English and machine-ish, like every other message the API sends. A 429 can be raised
    // before request.user exists (the keyGenerator falls back to request.ip for exactly that
    // reason), so there is no reliable language to render in here anyway. The stable
    // RATE_LIMITED code is the contract; the copy belongs to the client.
    errorResponseBuilder: () => new AppError(429, 'RATE_LIMITED', 'Too many requests'),
  });

  await app.register(healthRoutes);
  await app.register(meRoutes);
  await app.register(whiteboardRoutes);
  await app.register(noteRoutes);
  await app.register(subtaskRoutes);
  await app.register(memberRoutes);
  await app.register(shareLinkRoutes);

  return app;
}
