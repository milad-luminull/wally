import type { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { bindImportedIdentity } from './identities.js';
import { normalizeEmail } from '../db/collections.js';

/** CLI fixture only; never called by the server or used as an authentication bypass. */
export async function seedAuth0E2eIdentity(
  db: Firestore,
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  if (!env.FIRESTORE_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST)
    throw new Error('Auth0 E2E seeding requires the Firestore emulator');
  // The SDK exposes this getter at runtime but omits it from its public declaration.
  // Inspect the actual client, not a caller-supplied project label; absence fails closed.
  if (!('projectId' in db) || db.projectId !== 'wally-e2e')
    throw new Error('Auth0 E2E seeding requires project wally-e2e');
  const subject = z
    .string()
    .regex(/^auth0\|[^/\s]+$/)
    .parse(env.E2E_AUTH0_SUBJECT);
  const email = normalizeEmail(z.string().email().parse(env.E2E_AUTH0_EMAIL));
  await bindImportedIdentity(db, { issuer: 'https://login.luminull.com/', subject }, 'seed-owner');
  await db.collection('users').doc('seed-owner').update({ email });
}
