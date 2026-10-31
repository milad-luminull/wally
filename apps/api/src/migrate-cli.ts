import { loadEnv } from './env.js';
import { applyMigrations } from './lib/postgres/migrate.js';
import { createDatabase } from './lib/postgres/client.js';
import { assertPurgeScheduled } from './lib/db/purge.js';

/**
 * Applies every pending migration to the database DATABASE_URL names. Run by the compose
 * `migrate` service before the API starts, and by the release before a new revision serves.
 * The release adds --require-purge-job: the hosted database must have the hourly expiry job.
 */
const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--require-purge-job'))
  throw new Error('Usage: migrate-cli [--require-purge-job]');
const url = loadEnv().DATABASE_URL;
await applyMigrations(url);
console.log('Migrations applied.');
if (args.includes('--require-purge-job')) {
  const { db, close } = createDatabase(url, { max: 1 });
  try {
    await assertPurgeScheduled(db);
    console.log('The hourly expiry job is scheduled.');
  } finally {
    await close();
  }
}
