import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { users } from './schema/index.js';

type NewUser = typeof users.$inferInsert;

const user = (overrides: Partial<NewUser> = {}): NewUser => ({
  id: 'u1',
  email: 'max@example.com',
  displayName: 'Max',
  emailVerified: true,
  language: 'en',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('PostgreSQL client and test databases', () => {
  let handle: TestDatabase;

  beforeAll(async () => {
    handle = await createTestDatabase();
  });

  afterAll(async () => {
    await handle?.drop();
  });

  it('disables prepared statements', () => {
    expect(handle.sql.options.prepare).toBe(false);
  });

  it('gives this file its own database cloned from the migrated template', async () => {
    const [row] = await handle.sql`select current_database() as name`;
    expect(row!.name).toMatch(/^wally_test_[a-z0-9]{8}$/);
    const [users] = await handle.sql`select to_regclass('public.users')::text as t`;
    expect(users!.t).toBe('users');
  });

  it('stores jsonb as an object, not a JSON string', async () => {
    await handle.db.insert(users).values(user({ preferences: { theme: 'dark' } }));
    const [row] = await handle.sql`select jsonb_typeof(preferences) as t from users`;
    expect(row!.t).toBe('object');
  });

  it('round-trips a timestamp to the millisecond', async () => {
    const at = new Date('2026-10-27T10:11:12.345Z');
    await handle.db.insert(users).values(user({ id: 'u2', createdAt: at, updatedAt: at }));
    const [row] = await handle.db.select().from(users).where(eq(users.id, 'u2'));
    expect(row!.createdAt.getTime()).toBe(at.getTime());
  });

  it('rejects with a message naming DATABASE_URL when it is unset', async () => {
    vi.stubEnv('DATABASE_URL', '');
    try {
      await expect(createTestDatabase()).rejects.toThrow(/DATABASE_URL/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
