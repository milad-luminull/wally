import { getDb } from './lib/db/client.js';
import { seedAuth0E2eIdentity } from './lib/auth/e2e-seed.js';

const db = getDb();
try {
  await seedAuth0E2eIdentity(db);
  console.log('Auth0 E2E identity bound to the emulator seed owner.');
} finally {
  await db.terminate();
}
