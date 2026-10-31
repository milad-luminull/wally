import { loadEnv } from './env.js';
import { createDatabase } from './lib/postgres/client.js';
import { seedAuth0E2eIdentity } from './lib/auth/e2e-seed.js';

const { db, close } = createDatabase(loadEnv().DATABASE_URL);
try {
  await seedAuth0E2eIdentity(db);
  console.log('Auth0 E2E identity bound to the local seed owner.');
} finally {
  await close();
}
