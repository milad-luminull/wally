import postgres from 'postgres';
import { inject } from 'vitest';
import { createDatabase, type Database } from '../src/lib/postgres/client.js';
import { TEST_PREFIX, databaseUrl, randomId, templateDatabase } from './postgres-databases.js';

export { dropStaleDatabases } from './postgres-databases.js';

declare module 'vitest' {
  export interface ProvidedContext {
    /** This run's id, provided by test/postgres-global-setup.ts. */
    postgresRun: string;
  }
}

export type TestDatabase = {
  db: Database;
  sql: postgres.Sql;
  name: string;
  drop(): Promise<void>;
};

/**
 * A database of this test file's own, cloned from the run's migrated template.
 *
 * Files run in parallel, as they do on the Firestore emulator with a project id each:
 * no file can see or wipe another's rows. Call drop() in afterAll.
 */
export async function createTestDatabase(options: { max?: number } = {}): Promise<TestDatabase> {
  const url = process.env.DATABASE_URL;
  if (!url)
    throw new Error(
      'DATABASE_URL is not set: run the tests through `make test` or start the postgres service',
    );

  const run = inject('postgresRun');
  const name = `${TEST_PREFIX}${run}_${randomId(8)}`;

  const admin = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`create database "${name}" template "${templateDatabase(run)}"`);
  } finally {
    await admin.end();
  }

  const { db, sql, close } = createDatabase(databaseUrl(url, name), { max: options.max ?? 5 });
  return {
    db,
    sql,
    name,
    async drop() {
      await close();
      const dropper = postgres(url, { max: 1, onnotice: () => {} });
      try {
        await dropper.unsafe(`drop database if exists "${name}" with (force)`);
      } finally {
        await dropper.end();
      }
    },
  };
}
