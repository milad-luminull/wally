import { loadEnv } from './env.js';
import { applyMigrations } from './lib/postgres/migrate.js';

/**
 * Applies every pending migration to the database DATABASE_URL names. Run by the compose
 * `migrate` service before the API starts, and by the release before a new revision serves.
 */
await applyMigrations(loadEnv().DATABASE_URL);
console.log('Migrations applied.');
