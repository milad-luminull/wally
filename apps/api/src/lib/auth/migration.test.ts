import { describe, expect, it } from 'vitest';
import {
  buildMigrationPlan,
  verifyMigrationIdentity,
  executeMigration,
  type SourceUser,
} from './migration.js';
const source = (
  uid: string,
  providers = [{ providerId: 'password', uid: 'person@example.com' }],
): SourceUser => ({
  uid,
  email: `${uid}@example.com`,
  emailVerified: true,
  disabled: false,
  providers,
});
const plan = (users: SourceUser[]) =>
  buildMigrationPlan(
    'firebase-project',
    'Wally-Database',
    users,
    users.map((u) => u.uid),
  );
describe('controlled migration', () => {
  it('preserves unverified status and maps both provider methods to one stable user', () => {
    const result = plan([
      {
        ...source('a', [
          { providerId: 'password', uid: 'a@example.com' },
          { providerId: 'google.com', uid: '123' },
        ]),
        emailVerified: false,
      },
    ]);
    expect(result.importUsers[0]?.email_verified).toBe(false);
    expect(result.identities.map((i) => i.userId)).toEqual(['a', 'a']);
    expect(result.identities.map((i) => i.provider)).toEqual(['auth0', 'google-oauth2']);
  });
  it('exports deterministic password-reset records without credentials and keeps Firebase IDs', () => {
    const result = plan([
      source('b'),
      { ...source('a'), passwordHash: 'never-export' } as SourceUser,
    ]);
    expect(result).toEqual(plan([source('a'), source('b')]));
    expect(result.importUsers).toHaveLength(2);
    expect(result.importUsers[0]).toMatchObject({
      email: 'a@example.com',
      email_verified: true,
      app_metadata: { wally_firebase_uid: 'a', wally_firebase_project: 'firebase-project' },
    });
    expect(JSON.stringify(result)).not.toContain('never-export');
    expect(result.identities[0]?.userId).toBe('a');
  });
  it('quarantines duplicate emails, provider subjects, disabled, missing and unsupported users', () => {
    const users = [
      source('a'),
      { ...source('b'), email: 'A@example.com' },
      { ...source('c'), disabled: true },
      source('d', [{ providerId: 'phone', uid: 'phone' }]),
      source('e', [{ providerId: 'google.com', uid: 'same' }]),
      source('f', [{ providerId: 'google.com', uid: 'same' }]),
      source('missing'),
    ];
    const result = buildMigrationPlan('firebase-project', 'Wally-Database', users, [
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
    ]);
    expect(result.identities).toEqual([]);
    expect(result.issues.map((i) => i.userId).sort()).toEqual(users.map((u) => u.uid).sort());
  });
  it('does not import Google accounts into a password database', () => {
    const result = plan([source('a', [{ providerId: 'google.com', uid: '12345' }])]);
    expect(result.importUsers).toEqual([]);
    expect(result.identities[0]).toMatchObject({
      userId: 'a',
      subject: 'google-oauth2|12345',
      provider: 'google-oauth2',
    });
  });
  it('verifies database subjects by exact provider, connection and private source markers', () => {
    const result = plan([source('a')]);
    const identity = result.identities[0]!;
    const imported = result.importUsers[0]!;
    const evidence = {
      user_id: identity.subject,
      app_metadata: imported.app_metadata,
      identities: [{ provider: 'auth0', user_id: imported.user_id, connection: 'Wally-Database' }],
    };
    expect(() => verifyMigrationIdentity(result, identity, evidence)).not.toThrow();
    for (const bad of [
      { ...evidence, user_id: 'auth0|other' },
      { ...evidence, app_metadata: {} },
      { ...evidence, identities: [] },
      { ...evidence, blocked: true },
    ]) {
      expect(() => verifyMigrationIdentity(result, identity, bad)).toThrow();
    }
  });
  it('verifies Google by provider subject, never by email', () => {
    const result = plan([source('a', [{ providerId: 'google.com', uid: '12345' }])]);
    const identity = result.identities[0]!;
    expect(() =>
      verifyMigrationIdentity(result, identity, {
        user_id: identity.subject,
        identities: [{ provider: 'google-oauth2', user_id: '12345', connection: 'google-oauth2' }],
      }),
    ).not.toThrow();
    expect(() =>
      verifyMigrationIdentity(result, identity, {
        user_id: identity.subject,
        email: 'a@example.com',
        identities: [{ provider: 'google-oauth2', user_id: 'wrong', connection: 'google-oauth2' }],
      }),
    ).toThrow();
  });
  it('preflights all evidence before any mutation and makes dry-run read-only', async () => {
    const result = plan([source('a'), source('b')]);
    let writes = 0;
    const read = async (subject: string) => {
      const u = result.importUsers.find((u) => `auth0|${u.user_id}` === subject)!;
      return {
        user_id: subject,
        app_metadata: u.app_metadata,
        identities: [{ provider: 'auth0', user_id: u.user_id, connection: result.connection }],
      };
    };
    const bind = async () => {
      writes += 1;
    };
    expect(
      (await executeMigration(result, read, bind, false)).every((r) => r.status === 'verified'),
    ).toBe(true);
    expect(writes).toBe(0);
    await expect(
      executeMigration(
        result,
        async (s) => (s === result.identities[1]!.subject ? {} : read(s)),
        bind,
        true,
      ),
    ).rejects.toThrow();
    expect(writes).toBe(0);
    expect(
      (await executeMigration(result, read, bind, true)).every((r) => r.status === 'bound'),
    ).toBe(true);
    expect(writes).toBe(2);
  });
  it('reports mapping conflicts per subject without swallowing progress', async () => {
    const result = plan([
      source('a', [{ providerId: 'google.com', uid: '123' }]),
      source('b', [{ providerId: 'google.com', uid: '456' }]),
    ]);
    const reports = await executeMigration(
      result,
      async (s) => ({
        user_id: s,
        identities: [
          { provider: 'google-oauth2', user_id: s.split('|')[1], connection: 'google-oauth2' },
        ],
      }),
      async (_, uid) => {
        if (uid === 'a') throw new Error('conflict');
      },
      true,
    );
    expect(reports.map((r) => r.status)).toEqual(['failed', 'bound']);
  });
});
