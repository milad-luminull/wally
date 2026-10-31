import { applicationDefault, getApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { loadEnv } from '../env.js';

/**
 * The one firebase-admin App the process uses, for Auth token verification only.
 * Initialized lazily and reused — calling initializeApp twice for the same name throws.
 *
 * No service-account key is ever used (the organization's policy forbids creating one). On
 * Google Cloud the app uses Application Default Credentials, which the runtime service
 * account supplies; elsewhere just the project id, which is all token verification needs
 * (see plugins/firebase.ts).
 */
export function getFirebaseApp(): App {
  if (getApps().length > 0) return getApp();

  const env = loadEnv();
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

/** True when running on Cloud Run, which sets K_SERVICE and provides credentials itself. */
export function runsOnGoogleCloud(): boolean {
  return Boolean(process.env.K_SERVICE);
}
