import type { FastifyInstance } from 'fastify';

/**
 * GET /health — no auth, plain 200. Used by Docker/Cloud Run health checks.
 *
 * Deliberately not `/healthz`: Google Front End reserves that exact path on Cloud Run and
 * answers it with its own 404 before the request ever reaches the container.
 */
export default async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/health', async () => {
    return { status: 'ok' };
  });
}
