import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { createDatabase, type Database } from '../lib/postgres/client.js';
import { loadEnv } from '../env.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
  }
}

/**
 * Decorates the Fastify instance with the PostgreSQL database. A caller-supplied database
 * (tests pass their own per-file one) is used as-is and left open; one created here is
 * closed with the app.
 */
export default fp(
  async function postgresPlugin(fastify: FastifyInstance, opts: { database?: Database }) {
    if (opts.database) {
      fastify.decorate('db', opts.database);
      return;
    }
    const { db, close } = createDatabase(loadEnv().DATABASE_URL);
    fastify.decorate('db', db);
    fastify.addHook('onClose', close);
  },
  { name: 'postgres-plugin' },
);
