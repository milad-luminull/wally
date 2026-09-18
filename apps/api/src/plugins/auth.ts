import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { activatePendingInvitesForEmail } from '../lib/members.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthenticatedUser;
  }
}

/** Routes that must work without a token (health checks). Matched on path only. */
const PUBLIC_PATHS = new Set<string>(['/healthz']);

/**
 * Global auth preHandler. Verifies the bearer token via the injectable
 * `fastify.authVerifier` (see plugins/firebase.ts), then upserts the local User row,
 * lazily provisions that user's owned whiteboard, and auto-activates any pending invite
 * addressed to their email — all via atomic upserts so this is safe under concurrent
 * requests from a brand-new user (no check-then-create races).
 */
export default fp(
  async function authPlugin(fastify: FastifyInstance) {
    fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
      const path = request.url.split('?')[0] ?? request.url;
      if (request.method === 'GET' && PUBLIC_PATHS.has(path)) return;

      const header = request.headers.authorization;
      if (!header || !header.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Missing bearer token' });
      }
      const token = header.slice('Bearer '.length).trim();
      if (!token) {
        return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Missing bearer token' });
      }

      let decoded;
      try {
        decoded = await fastify.authVerifier.verifyIdToken(token);
      } catch {
        return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Invalid token' });
      }

      if (!decoded.email) {
        return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Token has no email' });
      }

      const email = decoded.email.toLowerCase();
      const displayName = decoded.name ?? null;

      const user = await fastify.prisma.user.upsert({
        where: { id: decoded.uid },
        update: { email, displayName },
        create: { id: decoded.uid, email, displayName },
      });

      // Lazily provision this user's own whiteboard. Atomic upsert on the ownerId
      // unique constraint — safe if two requests from the same brand-new user race.
      await fastify.prisma.whiteboard.upsert({
        where: { ownerId: user.id },
        update: {},
        create: { ownerId: user.id, name: 'Meine Wand' },
      });

      // Auto-activate any pending invite addressed to this email, on any whiteboard —
      // but only once Firebase confirms this user actually controls the address. Firebase
      // allows sign-up with an unverified email, so skipping this check would let anyone
      // claim someone else's pending invite just by typing in their email at signup,
      // with no access to that inbox at all.
      if (decoded.emailVerified) {
        await activatePendingInvitesForEmail(fastify.prisma, user.id, email);
      }

      request.user = { id: user.id, email: user.email, displayName: user.displayName };
    });
  },
  { name: 'auth-plugin', dependencies: ['prisma-plugin', 'firebase-plugin'] },
);
