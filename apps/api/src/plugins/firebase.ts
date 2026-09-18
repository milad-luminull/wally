import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { loadEnv } from '../env.js';

/** The minimal shape our app needs out of a verified Firebase ID token. */
export interface DecodedAuthToken {
  uid: string;
  email: string | null;
  name: string | null;
}

/** Injectable token-verification seam so tests can swap in a fake verifier. */
export interface AuthVerifier {
  verifyIdToken(idToken: string): Promise<DecodedAuthToken>;
}

declare module 'fastify' {
  interface FastifyInstance {
    authVerifier: AuthVerifier;
  }
}

export interface FirebasePluginOptions {
  /** Overrides the real firebase-admin-backed verifier — used by tests. */
  verifier?: AuthVerifier;
}

/**
 * Initializes firebase-admin from env vars (unless a test-provided verifier makes that
 * unnecessary) and decorates the Fastify instance with `authVerifier`, the seam
 * src/plugins/auth.ts calls instead of touching the Firebase SDK directly.
 */
export default fp(
  async function firebasePlugin(fastify: FastifyInstance, opts: FirebasePluginOptions) {
    if (opts.verifier) {
      fastify.decorate('authVerifier', opts.verifier);
      return;
    }

    const env = loadEnv();

    if (getApps().length === 0) {
      initializeApp({
        credential: cert({
          projectId: env.FIREBASE_PROJECT_ID,
          clientEmail: env.FIREBASE_CLIENT_EMAIL,
          // .env stores the key with literal "\n" sequences (real newlines don't survive
          // a single-line env value) — un-escape them before handing the key to the SDK.
          privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
      });
    }

    const auth = getAuth();

    fastify.decorate('authVerifier', {
      async verifyIdToken(idToken: string): Promise<DecodedAuthToken> {
        const decoded = await auth.verifyIdToken(idToken);
        return {
          uid: decoded.uid,
          email: decoded.email ?? null,
          name: (decoded.name as string | undefined) ?? null,
        };
      },
    });
  },
  { name: 'firebase-plugin' },
);
