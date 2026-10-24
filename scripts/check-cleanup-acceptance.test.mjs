import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
test('missing verified worker acceptance blocks release with actionable error', () => {
  const r = spawnSync(process.execPath, ['scripts/check-cleanup-acceptance.mjs'], {
    encoding: 'utf8',
    env: { ...process.env, ACCOUNT_CLEANUP_ACCEPTANCE_FILE: '/nonexistent-wally-evidence.json' },
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Verified cleanup acceptance is required/);
});
const { validateAcceptance } = await import('./check-cleanup-acceptance.mjs');
const env = {
  GCP_PROJECT_ID: 'fixture',
  GCP_REGION: 'eu',
  AUTH0_CLEANUP_SECRET_VERSION: 'secret:1',
  AUTH0_CLEANUP_CLIENT_ID: 'client',
  AUTH0_MANAGEMENT_DOMAIN: 'fixture.auth0.com',
};
const now = Date.now();
const evidence = {
  version: 1,
  checkedAt: new Date(now).toISOString(),
  sourceFingerprint: 'source',
  image: 'eu-docker.pkg.dev/fixture/wally/wally-api@sha256:' + 'a'.repeat(64),
  project: 'fixture',
  database: 'wally',
  workerServiceAccount: 'wally-account-cleanup@fixture.iam.gserviceaccount.com',
  secretVersion: 'secret:1',
  auth0ClientId: 'client',
  auth0ManagementDomain: 'fixture.auth0.com',
  evidenceUrl: 'https://github.com/milad-luminull/wally/actions/runs/fixture',
  checks: {
    workerDatabaseAccess: true,
    workerSecretAccess: true,
    auth0DeleteUsersScope: true,
    firebaseFixtureDeletion: true,
    auth0FixtureDeletion: true,
    idempotentRetry: true,
  },
};
test('fresh matching evidence pins the tested worker image', () =>
  assert.equal(validateAcceptance(evidence, env, 'source', now), evidence.image));
for (const [label, change] of Object.entries({
  stale: (e) => (e.checkedAt = new Date(now - 25 * 60 * 60 * 1000).toISOString()),
  source: (e) => (e.sourceFingerprint = 'other'),
  secret: (e) => (e.secretVersion = 'secret:2'),
  missingProvider: (e) => (e.checks.auth0FixtureDeletion = false),
  mutableImage: (e) => (e.image = 'repo:latest'),
}))
  test(`rejects ${label} acceptance`, () => {
    const e = structuredClone(evidence);
    change(e);
    assert.throws(() => validateAcceptance(e, env, 'source', now));
  });
