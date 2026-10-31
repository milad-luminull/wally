import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { loadEnv } from '../env.js';
import { parseModelRef } from '../lib/assistant/model/index.js';

/**
 * GET /health — no auth, plain 200. Used by Docker/Cloud Run health checks.
 *
 * Deliberately not `/healthz`: Google Front End reserves that exact path on Cloud Run and
 * answers it with its own 404 before the request ever reaches the container.
 *
 * Reports the assistant's configuration so a deploy can be checked without a model call;
 * parsing the reference also fails fast at boot on a malformed ASSISTANT_MODEL.
 *
 * Runs one trivial query, so a revision that cannot reach its database answers 503 and the
 * release's smoke test stops it before it takes traffic.
 */
export default async function healthRoutes(fastify: FastifyInstance) {
  const env = loadEnv();
  const { provider, model } = parseModelRef(env.ASSISTANT_MODEL);
  fastify.get('/health', async (request, reply) => {
    try {
      await fastify.db.execute(sql`select 1`);
    } catch (error) {
      request.log.error({ type: 'health.database', error: (error as Error).name });
      return reply.code(503).send({ status: 'unavailable', database: 'unreachable' });
    }
    return {
      status: 'ok',
      database: 'ok',
      assistant: { enabled: env.ASSISTANT_ENABLED, model: `${provider}:${model}` },
    };
  });
}
