import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { bindKnownIdentity } from './identities.js';
import { AUTH0_ISSUER } from './constants.js';
import { normalizeEmail } from '../db/records.js';
import { assertLocalDatabase } from '../db/local.js';
import type { Database } from '../postgres/client.js';
import { users } from '../postgres/schema/index.js';

/** CLI fixture only; never called by the server or used as an authentication bypass. */
export async function seedAuth0E2eIdentity(
  db: Database,
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  assertLocalDatabase(env, 'Auth0 E2E seeding');
  const subject = z
    .string()
    .regex(/^auth0\|[^/\s]+$/)
    .parse(env.E2E_AUTH0_SUBJECT);
  const email = normalizeEmail(z.string().email().parse(env.E2E_AUTH0_EMAIL));
  await bindKnownIdentity(db, { issuer: AUTH0_ISSUER, subject }, 'seed-owner');
  await db.update(users).set({ email }).where(eq(users.id, 'seed-owner'));
}
