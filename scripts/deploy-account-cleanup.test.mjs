import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function cleanup(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wally-release-test-'));
  const fake = `#!${process.execPath}
import { appendFileSync } from 'node:fs';
appendFileSync(process.env.LOG, JSON.stringify(process.argv.slice(2)) + '\\n');
`;
  writeFileSync(join(dir, 'gcloud'), fake);
  chmodSync(join(dir, 'gcloud'), 0o755);
  const result = spawnSync('bash', ['scripts/deploy-account-cleanup.sh'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: dir + ':' + process.env.PATH,
      LOG: join(dir, 'log'),
      GCP_PROJECT_ID: 'fixture',
      GCP_REGION: 'europe-west1',
      ACCOUNT_CLEANUP_IMAGE: 'fixture@sha256:abc',
      AUTH0_MANAGEMENT_DOMAIN: 'fixture.auth0.com',
      AUTH0_CLEANUP_CLIENT_ID: 'fixture',
      AUTH0_CLEANUP_SECRET_VERSION: 'fixture:1',
      ...overrides,
    },
  });
  let calls = [];
  try {
    calls = readFileSync(join(dir, 'log'), 'utf8').trim().split('\n').map(JSON.parse);
  } catch {}
  rmSync(dir, { recursive: true, force: true });
  return { ...result, calls };
}
test('the operator deploy sets the full worker configuration in one deploy', () => {
  const r = cleanup();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.calls.length, 1);
  const deploy = r.calls[0];
  assert.deepEqual(deploy.slice(0, 4), ['run', 'jobs', 'deploy', 'wally-account-cleanup']);
  for (const flag of [
    '--image=fixture@sha256:abc',
    '--service-account=wally-account-cleanup@fixture.iam.gserviceaccount.com',
    '--args=dist/account-maintenance.js,--apply',
    '--set-secrets=AUTH0_CLEANUP_CLIENT_SECRET=fixture:1',
  ])
    assert.ok(deploy.includes(flag), flag);
});
test('the operator deploy refuses to run without its configuration', () => {
  const r = cleanup({ AUTH0_CLEANUP_SECRET_VERSION: '' });
  assert.notEqual(r.status, 0);
  assert.equal(r.calls.length, 0);
});
