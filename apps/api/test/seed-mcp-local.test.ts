import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDatabase, resetDatabase, type TestDatabase } from './helpers.js';
import { seedMcpLocal } from '../src/lib/auth/local-mcp-seed.js';
import { resolveIdentity } from '../src/lib/auth/identities.js';
import { mcpConnections, users, whiteboards } from '../src/lib/postgres/schema/index.js';
let handle: TestDatabase;
const env = { DATABASE_URL: process.env.DATABASE_URL, NODE_ENV: 'test' };
const identity = { subject: 'google-oauth2|local-owner', email: 'owner@example.invalid' };
beforeAll(async () => {
  handle = await createTestDatabase();
});
beforeEach(() => resetDatabase(handle.db));
afterAll(() => handle?.drop());
it('creates synthetic boards idempotently without connecting an MCP client', async () => {
  const { db } = handle;
  await seedMcpLocal(db, identity, env);
  await seedMcpLocal(db, identity, env);
  expect(
    await resolveIdentity(db, { issuer: 'https://login.luminull.com/', subject: identity.subject }),
  ).toBe('mcp-local-owner');
  expect(await db.$count(whiteboards)).toBe(3);
  expect(await db.$count(mcpConnections, eq(mcpConnections.userId, 'mcp-local-owner'))).toBe(0);
});
it.each([
  ['a hosted database', { DATABASE_URL: 'postgres://u:p@db.abc.supabase.co:5432/postgres' }],
  ['no database URL', { DATABASE_URL: undefined }],
  ['a production process', { NODE_ENV: 'production' }],
])('refuses %s before writing', async (_label, override) => {
  await expect(seedMcpLocal(handle.db, identity, { ...env, ...override })).rejects.toThrow(
    'requires a local database',
  );
  expect(await handle.db.$count(users)).toBe(0);
});
