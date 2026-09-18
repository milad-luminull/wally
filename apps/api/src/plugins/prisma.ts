import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '../lib/prisma-client.js';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

/**
 * Decorates the Fastify instance with a single shared PrismaClient, closed on server
 * shutdown. A caller-supplied client (e.g. from tests) can be passed via options to
 * avoid opening a second pool.
 */
export default fp(
  async function prismaPlugin(fastify: FastifyInstance, opts: { client?: PrismaClient }) {
    const prisma = opts.client ?? new PrismaClient();
    fastify.decorate('prisma', prisma);
    fastify.addHook('onClose', async (instance) => {
      await instance.prisma.$disconnect();
    });
  },
  { name: 'prisma-plugin' },
);
