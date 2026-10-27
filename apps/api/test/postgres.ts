import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { createDatabase, type Database } from '../src/lib/postgres/client.js';

/** Migrated once per run by test/postgres-global-setup.ts. */
export const TEMPLATE_DATABASE = 'wally_template';

export type TestDatabase = {
  db: Database;
  sql: postgres.Sql;
  name: string;
  drop(): Promise<void>;
};

/** `url` with its database name replaced. */
export function databaseUrl(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/**
 * A database of this test file's own, cloned from the migrated template.
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

  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const suffix = Array.from(randomBytes(8), (byte) => alphabet[byte % alphabet.length]).join('');
  const name = `wally_test_${suffix}`;

  const admin = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`create database "${name}" template "${TEMPLATE_DATABASE}"`);
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
