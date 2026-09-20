import { applicationDefault, cert, getApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { loadEnv } from '../env.js';

/**
 * The one firebase-admin App the process uses, for both Auth token verification and
 * Firestore. Initialized lazily and reused — calling initializeApp twice for the same
 * name throws.
 *
 * When a service-account key is configured it is used; otherwise the app is initialized
 * with just the project id. That credential-less mode is what lets the API and the test
 * suites talk to the Firestore emulator (which needs no credentials at all) without a
 * service-account key on hand — see plugins/firebase.ts, which refuses to verify real ID
 * tokens in that mode rather than failing later at request time.
 */
export function getFirebaseApp(): App {
  if (getApps().length > 0) return getApp();

  const env = loadEnv();
  if (env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    return initializeApp({
      credential: cert({
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        // .env stores the key with literal "\n" sequences (real newlines don't survive
        // a single-line env value) — un-escape them before handing the key to the SDK.
        privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
  }

  if (runsOnGoogleCloud()) {
    // On Cloud Run (and any Google environment) the runtime service account supplies
    // credentials automatically, so there is no key file to ship.
    return initializeApp({
      credential: applicationDefault(),
      projectId: env.FIREBASE_PROJECT_ID,
    });
  }

  return initializeApp({ projectId: env.FIREBASE_PROJECT_ID });
}

/** Whether a real service-account credential is configured on this process. */
export function hasServiceAccountCredentials(): boolean {
  const env = loadEnv();
  return Boolean(env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY);
}

/** True when running on Cloud Run, which sets K_SERVICE and provides credentials itself. */
export function runsOnGoogleCloud(): boolean {
  return Boolean(process.env.K_SERVICE);
}
