import type { FastifyInstance } from 'fastify';

/** GET /healthz — no auth, plain 200. Used by Docker/Cloud Run health checks. */
export default async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/healthz', async () => {
    return { status: 'ok' };
  });
}
