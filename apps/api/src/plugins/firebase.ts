import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { getAuth } from 'firebase-admin/auth';
import { getFirebaseApp, hasServiceAccountCredentials, runsOnGoogleCloud } from '../lib/firebase-app.js';

/** The minimal shape our app needs out of a verified Firebase ID token. */
export interface DecodedAuthToken {
  uid: string;
  email: string | null;
  /**
   * Whether Firebase has confirmed the user actually controls this email address (they
   * clicked a verification link, or it came from a provider that already verifies it,
   * e.g. Google). Firebase itself allows sign-up with an unverified email, so this must
   * be checked before trusting `email` for anything privilege-granting — see
   * src/plugins/auth.ts's use of it before auto-activating a pending invite.
   */
  emailVerified: boolean;
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
 * Decorates the Fastify instance with `authVerifier`, the seam src/plugins/auth.ts calls
 * instead of touching the Firebase SDK directly.
 *
 * Firestore may run against the local emulator without credentials, but verifying real ID
 * tokens cannot — so this refuses to start without a service account rather than failing
 * per-request later. Tests supply their own verifier and never reach that check.
 */
export default fp(
  async function firebasePlugin(fastify: FastifyInstance, opts: FirebasePluginOptions) {
    if (opts.verifier) {
      fastify.decorate('authVerifier', opts.verifier);
      return;
    }

    if (!hasServiceAccountCredentials() && !runsOnGoogleCloud()) {
      throw new Error(
        'FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY are required to verify Firebase ID ' +
          'tokens outside Google Cloud. See the Firebase setup section of README.md.',
      );
    }

    const auth = getAuth(getFirebaseApp());

    fastify.decorate('authVerifier', {
      async verifyIdToken(idToken: string): Promise<DecodedAuthToken> {
        const decoded = await auth.verifyIdToken(idToken);
        return {
          uid: decoded.uid,
          email: decoded.email ?? null,
          emailVerified: decoded.email_verified ?? false,
          name: (decoded.name as string | undefined) ?? null,
        };
      },
    });
  },
  { name: 'firebase-plugin' },
);
