import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type { Firestore } from 'firebase-admin/firestore';
import { getDb } from '../lib/db/client.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Firestore;
  }
}

/**
 * Decorates the Fastify instance with the shared Firestore client. There is no connection
 * to close on shutdown — the Admin SDK manages its own channels.
 *
 * A caller-supplied instance (tests pass one scoped to their own emulator project id) is
 * used as-is.
 */
export default fp(
  async function firestorePlugin(fastify: FastifyInstance, opts: { db?: Firestore }) {
    fastify.decorate('db', opts.db ?? getDb());
  },
  { name: 'firestore-plugin' },
);
