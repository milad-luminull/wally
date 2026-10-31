import postgres from 'postgres';
import type { TestProject } from 'vitest/node';
import { applyMigrations } from '../src/lib/postgres/migrate.js';
import {
  databaseUrl,
  dropStaleDatabases,
  newRunId,
  runDatabasePattern,
  templateDatabase,
} from './postgres-databases.js';

/**
 * Migrates this run's template database; each PostgreSQL test file then clones it
 * (test/postgres.ts). Leftovers of crashed runs are dropped first; databases of other
 * runs in progress on the same server are left alone.
 *
 * Without DATABASE_URL there is nothing to prepare: the suites that need PostgreSQL fail
 * in createTestDatabase() with a message saying so, and everything else still runs.
 */
export default async function setup(
  project: TestProject,
): Promise<(() => Promise<void>) | undefined> {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;

  const run = newRunId();
  const template = templateDatabase(run);
  const admin = postgres(url, { max: 1, onnotice: () => {} });
  const dropOwn = async () => {
    const own = await admin<{ datname: string }[]>`
      select datname from pg_database
      where datname like ${runDatabasePattern(run)}
         or datname = ${template}`;
    for (const { datname } of own)
      await admin.unsafe(`drop database if exists "${datname}" with (force)`);
  };

  try {
    await dropStaleDatabases(admin);
    await admin.unsafe(`create database "${template}"`);
    await applyMigrations(databaseUrl(url, template));
  } catch (error) {
    await dropOwn().catch(() => {});
    await admin.end();
    throw error;
  }
  project.provide('postgresRun', run);

  return async () => {
    await dropOwn();
    await admin.end();
  };
}
