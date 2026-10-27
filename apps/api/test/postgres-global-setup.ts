import postgres from 'postgres';
import { applyMigrations } from '../src/lib/postgres/migrate.js';
import { TEMPLATE_DATABASE, databaseUrl } from './postgres.js';

/**
 * Migrates one template database per test run; each PostgreSQL test file then clones it
 * (test/postgres.ts). One test run owns a database server, so leftovers of a crashed run
 * are dropped first.
 *
 * Without DATABASE_URL there is nothing to prepare: the suites that need PostgreSQL fail
 * in createTestDatabase() with a message saying so, and everything else still runs.
 */
export default async function setup(): Promise<(() => Promise<void>) | undefined> {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;

  const admin = postgres(url, { max: 1, onnotice: () => {} });
  const dropAll = async () => {
    const stale = await admin<{ datname: string }[]>`
      select datname from pg_database
      where datname like 'wally\\_test\\_%' or datname = ${TEMPLATE_DATABASE}`;
    for (const { datname } of stale)
      await admin.unsafe(`drop database if exists "${datname}" with (force)`);
  };

  try {
    await dropAll();
    await admin.unsafe(`create database "${TEMPLATE_DATABASE}"`);
    await applyMigrations(databaseUrl(url, TEMPLATE_DATABASE));
  } catch (error) {
    await admin.end();
    throw error;
  }

  return async () => {
    await dropAll();
    await admin.end();
  };
}
