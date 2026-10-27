import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getFirebaseApp } from '../firebase-app.js';
import { loadEnv } from '../../env.js';

let cached: Firestore | undefined;

/**
 * The process-wide Firestore instance, created once.
 *
 * `settings()` may only be called before the instance is first used and only once, so it
 * lives here rather than in the Fastify plugin (which tests build repeatedly).
 * `ignoreUndefinedProperties` matters because the route handlers build patch objects with
 * optional fields, and Firestore throws on an `undefined` value by default rather than
 * treating it as "leave this field alone".
 *
 * FIRESTORE_DATABASE_ID selects a named database. It must be set in production: this
 * project's "(default)" database was auto-created in the US (nam5), while the real one
 * (`wally`) is in the EU. Left unset locally, where the emulator serves "(default)".
 */
export function getDb(): Firestore {
  if (cached) return cached;
  const app = getFirebaseApp();
  const { FIRESTORE_DATABASE_ID } = loadEnv();
  const db = FIRESTORE_DATABASE_ID ? getFirestore(app, FIRESTORE_DATABASE_ID) : getFirestore(app);
  db.settings({ ignoreUndefinedProperties: true });
  cached = db;
  return db;
}
