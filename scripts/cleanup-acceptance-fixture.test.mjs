import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAcceptance } from './check-cleanup-acceptance.mjs';
import { acceptanceRecord, idsHash } from './cleanup-acceptance-fixture.mjs';

const env = {
  GCP_PROJECT_ID: 'luminull-wally',
  GCP_REGION: 'europe-west1',
  AUTH0_CLEANUP_SECRET_VERSION: 'wally-auth0-account-cleanup:1',
  AUTH0_CLEANUP_CLIENT_ID: 'cleanup-client',
  AUTH0_MANAGEMENT_DOMAIN: 'tenant.eu.auth0.com',
  IMAGE: `europe-west1-docker.pkg.dev/luminull-wally/wally/wally-api@sha256:${'a'.repeat(64)}`,
  STATUS_EXECUTION: 'wally-account-cleanup-aaaaa',
  DELETION_EXECUTION: 'wally-account-cleanup-bbbbb',
  REPLAY_EXECUTION: 'wally-account-cleanup-ccccc',
  EVIDENCE_URL: 'https://github.com/milad-luminull/wally/pull/1',
};
const passed = { verified: true, replayed: true, scopeChecked: true };

test('a fully verified fixture produces a record the release guard accepts', () => {
  const record = acceptanceRecord(passed, env, 'f'.repeat(64));
  assert.equal(validateAcceptance(record, env, 'f'.repeat(64)), env.IMAGE);
});

test('an unfinished fixture cannot produce a record', () => {
  assert.throws(
    () => acceptanceRecord({ verified: true, scopeChecked: true }, env, 'f'),
    /incomplete: replayed/,
  );
});

test('the record needs the exact tested image digest', () => {
  assert.throws(
    () =>
      acceptanceRecord(
        passed,
        { ...env, IMAGE: 'europe-west1-docker.pkg.dev/luminull-wally/wally/wally-api:latest' },
        'f',
      ),
    /exact tested/,
  );
});

test('baseline hashes ignore document order', () => {
  assert.equal(idsHash(['b', 'a']), idsHash(['a', 'b']));
  assert.notEqual(idsHash(['a']), idsHash(['a', 'c']));
});
