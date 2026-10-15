import type { FastifyInstance } from 'fastify';
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
 */
export default async function healthRoutes(fastify: FastifyInstance) {
  const env = loadEnv();
  const { provider, model } = parseModelRef(env.ASSISTANT_MODEL);
  fastify.get('/health', async () => {
    return {
      status: 'ok',
      assistant: { enabled: env.ASSISTANT_ENABLED, model: `${provider}:${model}` },
    };
  });
}
