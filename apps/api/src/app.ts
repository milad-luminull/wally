import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { PrismaClient } from './lib/prisma-client.js';
import { loadEnv } from './env.js';
import prismaPlugin from './plugins/prisma.js';
import firebasePlugin, { type AuthVerifier } from './plugins/firebase.js';
import authPlugin from './plugins/auth.js';
import healthRoutes from './routes/health.js';
import whiteboardRoutes from './routes/whiteboards.js';
import noteRoutes from './routes/notes.js';
import subtaskRoutes from './routes/subtasks.js';
import memberRoutes from './routes/members.js';
import shareLinkRoutes from './routes/share-links.js';
import referenceOptionRoutes from './routes/reference-options.js';
import { AppError } from './lib/errors.js';

export interface BuildAppOptions {
  /** Overrides the shared PrismaClient — tests pass one pointed at a test database. */
  prismaClient?: PrismaClient;
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

  await app.register(prismaPlugin, { client: options.prismaClient });
  await app.register(firebasePlugin, { verifier: options.authVerifier });
  await app.register(authPlugin);

  await app.register(healthRoutes);
  await app.register(whiteboardRoutes);
  await app.register(noteRoutes);
  await app.register(subtaskRoutes);
  await app.register(memberRoutes);
  await app.register(shareLinkRoutes);
  await app.register(referenceOptionRoutes);

  return app;
}
