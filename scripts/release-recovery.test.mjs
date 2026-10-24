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
const a=process.argv.slice(2); appendFileSync(process.env.LOG,JSON.stringify(a)+'\\n');
if(a[0]==='scheduler'&&a[2]==='describe') {
 if(process.env.DENIED) {console.error('PERMISSION_DENIED');process.exit(1);}
 console.log(JSON.stringify({state:process.env.STATE||'PAUSED'}));
} else if(a[0]==='run'&&a[1]==='jobs'&&a[2]==='describe') {
 console.log(JSON.stringify({status:{conditions:[{type:'Ready',status:'True'}]},spec:{template:{spec:{template:{spec:{containers:[{image:process.env.ACCOUNT_CLEANUP_IMAGE}]}}}}}}));
} else if(a[0]==='run'&&a[1]==='jobs'&&a[2]==='get-iam-policy') {
 console.log(JSON.stringify({bindings:[{role:'roles/run.invoker',members:['serviceAccount:wally-account-scheduler@fixture.iam.gserviceaccount.com']}]}));
} else if(a[0]==='run'&&a[1]==='jobs'&&a[2]==='executions') console.log('[]');
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
const mutates = (a) =>
  a.includes('deploy') ||
  a.includes('create') ||
  a.includes('update') ||
  a.includes('add-iam-policy-binding');
test('denied scheduler read stops before any cloud mutation', () => {
  const r = cleanup({ DENIED: '1' });
  assert.notEqual(r.status, 0);
  assert.deepEqual(r.calls.filter(mutates), []);
});
test('enabled scheduler stops before worker replacement', () => {
  const r = cleanup({ STATE: 'ENABLED' });
  assert.notEqual(r.status, 0);
  assert.deepEqual(r.calls.filter(mutates), []);
});
test('ordinary worker deploy never grants IAM or creates scheduler or TTL', () => {
  const r = cleanup();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.calls.filter((a) => a.includes('deploy')).length, 1);
  assert.equal(
    r.calls.some(
      (a) =>
        a.includes('add-iam-policy-binding') ||
        a[0] === 'firestore' ||
        a.includes('create') ||
        a.includes('update'),
    ),
    false,
  );
});
