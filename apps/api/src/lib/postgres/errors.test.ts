import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { classifyDatabaseError } from './errors.js';
import { notes, users } from './schema/index.js';

const at = new Date('2026-10-27T09:00:00.000Z');

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the statement to be rejected');
}

describe('classifyDatabaseError', () => {
  let handle: TestDatabase;

  beforeAll(async () => {
    handle = await createTestDatabase();
    await handle.db.insert(users).values({
      id: 'u1',
      email: 'max@example.com',
      emailVerified: true,
      language: 'en',
      createdAt: at,
      updatedAt: at,
    });
  });

  afterAll(async () => {
    await handle?.drop();
  });

  const note = { id: 'n1', title: 'Book the venue', priority: 'MEDIUM', horizon: 'TODAY' } as const;
  const noteRow = (overrides: Partial<typeof notes.$inferInsert>) => ({
    ...note,
    boardId: 'missing',
    status: 'OPEN' as const,
    freeX: 0,
    freeY: 0,
    colour: 'CHALK' as const,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  });

  it('classifies a duplicate key as unique', async () => {
    const error = await failureOf(
      handle.db.insert(users).values({
        id: 'u1',
        email: 'max@example.com',
        emailVerified: true,
        language: 'en',
        createdAt: at,
        updatedAt: at,
      }),
    );
    expect(classifyDatabaseError(error)).toBe('unique');
  });

  it('classifies a reference to a missing row as foreignKey', async () => {
    const error = await failureOf(handle.db.insert(notes).values(noteRow({})));
    expect(classifyDatabaseError(error)).toBe('foreignKey');
  });

  it('classifies a value outside a check constraint as check', async () => {
    const error = await failureOf(
      handle.db.insert(notes).values(noteRow({ status: 'ARCHIVED' as 'OPEN' })),
    );
    expect(classifyDatabaseError(error)).toBe('check');
  });

  it('classifies serialization failures and deadlocks, on the error or its cause', () => {
    expect(classifyDatabaseError({ code: '40001' })).toBe('serialization');
    expect(classifyDatabaseError({ cause: { code: '40P01' } })).toBe('deadlock');
  });

  it('returns null for anything else', () => {
    expect(classifyDatabaseError(new Error('x'))).toBeNull();
    expect(classifyDatabaseError({ code: '42P01' })).toBeNull();
    expect(classifyDatabaseError(undefined)).toBeNull();
  });
});
