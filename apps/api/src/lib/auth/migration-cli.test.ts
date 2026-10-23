import { describe, expect, it } from 'vitest';
import {
  parseMigrationArgs,
  readMigrationSource,
  splitImportUsers,
  assertReviewedPlan,
  selectMigrationPlan,
} from './migration-cli.js';
import { buildMigrationPlan } from './migration.js';
describe('migration command safeguards', () => {
  it('keeps global ambiguity checks when selecting a resumable batch', () => {
    const users = ['a', 'b'].map((uid) => ({
      uid,
      email: 'same@example.com',
      emailVerified: false,
      disabled: false,
      providers: [{ providerId: 'password', uid }],
    }));
    const plan = buildMigrationPlan('p', 'db', users, ['a', 'b']);
    const selected = selectMigrationPlan(plan, ['a']);
    expect(selected.identities).toEqual([]);
    expect(selected.issues).toEqual([{ userId: 'a', reasons: ['duplicate-email'] }]);
    expect(() => selectMigrationPlan(plan, ['missing'])).toThrow();
  });
  it('defaults verification to read-only and requires an explicit project confirmation to apply', () => {
    const args = ['verify', '--project', 'p', '--connection', 'db', '--plan', '/tmp/plan.json'];
    expect(parseMigrationArgs(args).apply).toBe(false);
    expect(() => parseMigrationArgs([...args, '--apply'])).toThrow();
    expect(() => parseMigrationArgs([...args, '--apply', '--confirm-project', 'other'])).toThrow();
    expect(parseMigrationArgs([...args, '--apply', '--confirm-project', 'p']).apply).toBe(true);
    expect(() =>
      parseMigrationArgs([
        'export',
        '--project',
        'p',
        '--connection',
        'db',
        '--output',
        '/tmp/out',
        '--apply',
        '--confirm-project',
        'p',
      ]),
    ).toThrow();
    expect(() => parseMigrationArgs([...args, '--unknown'])).toThrow();
  });
  it('requires a reviewed plan and explicit apply confirmation for Google preparation', () => {
    const args = [
      'prepare-google',
      '--project',
      'p',
      '--connection',
      'db',
      '--plan',
      '/tmp/plan.json',
    ];
    expect(parseMigrationArgs(args).apply).toBe(false);
    expect(() => parseMigrationArgs([...args, '--apply'])).toThrow();
    expect(parseMigrationArgs([...args, '--apply', '--confirm-project', 'p']).apply).toBe(true);
    expect(() => parseMigrationArgs(args.slice(0, -2))).toThrow();
  });
  it('projects only permitted metadata while paging Firebase users', async () => {
    const result = await readMigrationSource(async (_, token) =>
      token === 'next'
        ? { users: [{ uid: 'b', emailVerified: false, disabled: false, providerData: [] }] }
        : {
            users: [
              {
                uid: 'a',
                email: 'a@example.com',
                emailVerified: true,
                disabled: false,
                passwordHash: 'secret',
                providerData: [{ providerId: 'google.com', uid: '123', email: 'extra' }],
              },
            ],
            pageToken: 'next',
          },
    );
    expect(result).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(result[0]?.providers).toEqual([{ providerId: 'google.com', uid: '123' }]);
  });
  it('refuses changed or tampered review plans', () => {
    const plan = buildMigrationPlan('p', 'db', [], []);
    expect(() => assertReviewedPlan(plan, JSON.parse(JSON.stringify(plan)))).not.toThrow();
    expect(() => assertReviewedPlan(plan, { ...plan, project: 'other' })).toThrow();
  });
  it('splits import arrays under the byte limit without losing users', () => {
    const users = ['a', 'b', 'c'].map((uid) => ({
      uid,
      email: `${uid}@example.com`,
      emailVerified: false,
      disabled: false,
      providers: [{ providerId: 'password', uid }],
    }));
    const plan = buildMigrationPlan('p', 'db', users, ['a', 'b', 'c']);
    const chunks = splitImportUsers(plan.importUsers, 420);
    expect(chunks.flatMap((s) => JSON.parse(s))).toEqual(plan.importUsers);
    expect(chunks.every((s) => Buffer.byteLength(s) <= 420)).toBe(true);
    expect(() => splitImportUsers(plan.importUsers, 10)).toThrow();
  });
});
