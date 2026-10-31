import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { getAuth } from 'firebase-admin/auth';
import { getFirebaseApp } from '../lib/firebase-app.js';

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
 * Verifying a real ID token needs no credential — only the project id — so the same code
 * runs on Cloud Run, in compose and in CI without a service-account key, which the
 * organization's iam.disableServiceAccountKeyCreation policy blocks anyway. Tests supply
 * their own verifier.
 */
export default fp(
  async function firebasePlugin(fastify: FastifyInstance, opts: FirebasePluginOptions) {
    if (opts.verifier) {
      fastify.decorate('authVerifier', opts.verifier);
      return;
    }

    // firebase-admin fetches Google's public x509 certs over unauthenticated HTTPS and
    // checks aud/iss against the project id, which initializeApp({ projectId }) already
    // supplies (see firebase-admin's auth/token-verifier.js and utils.findProjectId — the
    // latter short-circuits on app.options.projectId and never consults the credential).
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
