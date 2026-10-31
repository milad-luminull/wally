import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { randomId } from './postgres-databases.js';
import { createTestDatabase, dropStaleDatabases, type TestDatabase } from './postgres.js';

/**
 * Several test runs can share one database server (two worktrees, a watch run beside
 * `make test`). Each run names its databases after itself and removes only its own, plus
 * leftovers of runs that started more than two hours ago.
 */
describe('the PostgreSQL test harness', () => {
  let handle: TestDatabase;
  let admin: postgres.Sql;

  beforeAll(async () => {
    handle = await createTestDatabase();
    admin = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  });

  afterAll(async () => {
    await admin?.end();
    await handle?.drop();
  });

  const exists = async (name: string) =>
    (await admin`select 1 from pg_database where datname = ${name}`).length === 1;

  it("names this file's database after the run", () => {
    expect(handle.name.startsWith(`wally_test_${inject('postgresRun')}_`)).toBe(true);
    expect(handle.name).toMatch(/^wally_test_[0-9a-z]+_[0-9a-z]{4}_[0-9a-z]{8}$/);
  });

  it('drops leftovers of old runs and leaves recent runs alone', async () => {
    const now = Date.now();
    const threeHoursAgo = (now - 3 * 3_600_000).toString(36);
    const old = `wally_test_${threeHoursAgo}_${randomId(4)}_${randomId(8)}`;
    const oldTemplate = `wally_template_${threeHoursAgo}_${randomId(4)}`;
    const legacy = `wally_test_${randomId(8)}`;
    const recent = `wally_test_${(now - 60_000).toString(36)}_${randomId(4)}_${randomId(8)}`;
    for (const name of [old, oldTemplate, legacy, recent])
      await admin.unsafe(`create database "${name}"`);

    try {
      await dropStaleDatabases(admin, now);

      // Asserted by what is left, not by what this call returned: a concurrent run may
      // have dropped the same leftovers first.
      for (const name of [old, oldTemplate, legacy]) expect(await exists(name), name).toBe(false);
      expect(await exists(recent)).toBe(true);
      expect(await exists(handle.name)).toBe(true);
      expect(await exists(`wally_template_${inject('postgresRun')}`)).toBe(true);
    } finally {
      for (const name of [old, oldTemplate, legacy, recent])
        await admin.unsafe(`drop database if exists "${name}" with (force)`);
    }
  });
});
