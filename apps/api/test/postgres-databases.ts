import { randomBytes } from 'node:crypto';
import type postgres from 'postgres';

/*
 * Naming and cleanup of the PostgreSQL test databases. Kept free of Vitest's test runtime:
 * the global setup, which runs outside any test file, imports it too.
 */

/**
 * Database names carry the run that made them: `wally_template_<run>` and
 * `wally_test_<run>_<random>`, where `<run>` is `<start millis, base 36>_<random>`. Several
 * runs can then share one server, each removing only its own databases, and a crashed
 * run's leftovers can be told apart by age.
 */
export const TEST_PREFIX = 'wally_test_';
const TEMPLATE_PREFIX = 'wally_template_';
/** No test run lasts this long; anything older was left behind by one that died. */
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

export function randomId(length: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(randomBytes(length), (byte) => alphabet[byte % alphabet.length]).join('');
}

export function newRunId(now = Date.now()): string {
  return `${now.toString(36)}_${randomId(4)}`;
}

export const templateDatabase = (run: string) => `${TEMPLATE_PREFIX}${run}`;
/** A LIKE pattern matching exactly this run's test databases. */
export const runDatabasePattern = (run: string) =>
  `${`${TEST_PREFIX}${run}_`.replace(/[\\%_]/g, '\\$&')}%`;

/** `url` with its database name replaced. */
export function databaseUrl(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/** The start time a harness database name carries, or null for any other shape. */
function runStartedAt(name: string): number | null {
  const match = /^wally_(?:test|template)_([0-9a-z]+)_[0-9a-z]{4}(?:_[0-9a-z]{8})?$/.exec(name);
  return match ? parseInt(match[1]!, 36) : null;
}

/**
 * Drops harness databases left behind by runs that started more than two hours before
 * `now`, and any in an older naming shape. Databases of runs still in progress stay.
 * Returns the names it dropped.
 */
export async function dropStaleDatabases(admin: postgres.Sql, now = Date.now()): Promise<string[]> {
  const rows = await admin<{ datname: string }[]>`
    select datname from pg_database
    where datname like 'wally\\_test\\_%' or datname like 'wally\\_template%'`;
  const stale = rows
    .map((row) => row.datname)
    .filter((name) => {
      const startedAt = runStartedAt(name);
      return startedAt === null || now - startedAt > STALE_AFTER_MS;
    });
  for (const name of stale) await admin.unsafe(`drop database if exists "${name}" with (force)`);
  return stale;
}
