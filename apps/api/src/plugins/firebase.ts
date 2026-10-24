import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { getAuth } from 'firebase-admin/auth';
import {
  getFirebaseApp,
  hasServiceAccountCredentials,
  runsOnGoogleCloud,
} from '../lib/firebase-app.js';
import { loadEnv } from '../env.js';

/** The minimal shape our app needs out of a verified Firebase ID token. */
export interface DecodedAuthToken {
  authenticatedAt?: number;
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
 * Verifying a real ID token needs no credential — only the project id. A credential is
 * required for *Firestore*, so this refuses to start only when the process would talk to a
 * real database without one, rather than failing per-request later. Pointing
 * FIRESTORE_EMULATOR_HOST at an emulator satisfies it. Tests supply their own verifier and
 * never reach the check at all.
 */
export default fp(
  async function firebasePlugin(fastify: FastifyInstance, opts: FirebasePluginOptions) {
    if (opts.verifier) {
      fastify.decorate('authVerifier', opts.verifier);
      return;
    }

    // Verifying an ID token needs no credential at all: firebase-admin fetches Google's
    // public x509 certs over unauthenticated HTTPS and checks aud/iss against the project
    // id, which initializeApp({ projectId }) already supplies (see firebase-admin's
    // auth/token-verifier.js and utils.findProjectId — the latter short-circuits on
    // app.options.projectId and never consults the credential).
    //
    // What a credential is genuinely required for is *Firestore*. So that is what this
    // guard should ask about: FIRESTORE_EMULATOR_HOST means the Admin SDK is not talking to
    // a real database, and the emulator needs no credentials. That is what lets
    // docker-compose and CI run the full stack against real Firebase Auth without a
    // service-account key — which the organization's iam.disableServiceAccountKeyCreation
    // policy blocks from being created anyway (see README.md).
    //
    // Production is unaffected: it has no FIRESTORE_EMULATOR_HOST, and env.ts now makes
    // NODE_ENV=production together with FIRESTORE_EMULATOR_HOST a fatal startup error.
    const usingFirestoreEmulator = Boolean(loadEnv().FIRESTORE_EMULATOR_HOST);
    if (!hasServiceAccountCredentials() && !runsOnGoogleCloud() && !usingFirestoreEmulator) {
      throw new Error(
        'FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY are required to verify Firebase ID ' +
          'tokens against a real Firestore database outside Google Cloud. Set them, or point ' +
          'FIRESTORE_EMULATOR_HOST at an emulator. See the Firebase setup section of README.md.',
      );
    }

    const auth = getAuth(getFirebaseApp());

    fastify.decorate('authVerifier', {
      async verifyIdToken(idToken: string): Promise<DecodedAuthToken> {
        const decoded = await auth.verifyIdToken(idToken);
        return {
          uid: decoded.uid,
          authenticatedAt: decoded.auth_time,
          email: decoded.email ?? null,
          emailVerified: decoded.email_verified ?? false,
          name: (decoded.name as string | undefined) ?? null,
        };
      },
    });
  },
  { name: 'firebase-plugin' },
);
