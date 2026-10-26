import { afterAll, beforeEach, expect, it } from 'vitest';
import { getTestDb, resetDatabase } from './helpers.js';
import { seedMcpLocal } from '../src/lib/auth/local-mcp-seed.js';
import { resolveIdentity } from '../src/lib/auth/identities.js';
const project = 'wally-mcp-local-test';
const db = getTestDb(project);
const identity = { subject: 'google-oauth2|local-owner', email: 'owner@example.invalid' };
beforeEach(() => resetDatabase(project));
afterAll(() => db.terminate());
it('creates synthetic boards idempotently with no implicit MCP consent', async () => {
  await seedMcpLocal(db, identity);
  await seedMcpLocal(db, identity);
  expect(
    await resolveIdentity(db, { issuer: 'https://login.luminull.com/', subject: identity.subject }),
  ).toBe('mcp-local-owner');
  expect((await db.collection('whiteboards').get()).size).toBe(3);
  expect((await db.collection('mcpBoardPolicies').get()).empty).toBe(true);
  expect(
    (await db.collection('users').doc('mcp-local-owner').collection('mcpConnections').get()).empty,
  ).toBe(true);
});
it('refuses another project before writing', async () => {
  const other = getTestDb('wally-mcp-seed-wrong');
  // A local emulator started with --import gives every untouched project that data.
  await resetDatabase('wally-mcp-seed-wrong');
  await expect(seedMcpLocal(other, identity)).rejects.toThrow('project');
  expect((await other.collection('users').get()).empty).toBe(true);
  await other.terminate();
});
it('refuses missing emulator configuration', async () => {
  await expect(seedMcpLocal(db, identity, {})).rejects.toThrow('emulator');
  expect((await db.collection('users').get()).empty).toBe(true);
});
