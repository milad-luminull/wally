import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase } from './client.js';

/** apps/api/drizzle, where drizzle-kit writes the SQL migrations. */
const migrationsFolder = fileURLToPath(new URL('../../../drizzle', import.meta.url));

/** Applies every pending migration to the database at `url`, on one connection. */
export async function applyMigrations(url: string): Promise<void> {
  const { db, close } = createDatabase(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await close();
  }
}
