import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function cleanup(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wally-release-test-'));
  const fake = `#!${process.execPath}
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
const a=process.argv.slice(2); appendFileSync(process.env.LOG,JSON.stringify(a)+'\\n');
if(a[0]==='scheduler'&&a[2]==='describe') {
 if(process.env.DENIED) {console.error('PERMISSION_DENIED');process.exit(1);}
 console.log(JSON.stringify({state:existsSync(process.env.LOG+'.paused')?'PAUSED':process.env.STATE||'PAUSED'}));
} else if(a[0]==='scheduler'&&a[2]==='pause') {
 if(process.env.PAUSE_WORKS) writeFileSync(process.env.LOG+'.paused','yes');
} else if(a[0]==='run'&&a[1]==='jobs'&&a[2]==='execute') {
 if(process.env.CHECK_FAILS) process.exit(1);
} else if(a[0]==='run'&&a[1]==='jobs'&&a[2]==='describe') {
 console.log(JSON.stringify({status:{conditions:[{type:'Ready',status:'True'}]},spec:{template:{spec:{template:{spec:{containers:[{image:process.env.ACCOUNT_CLEANUP_IMAGE}]}}}}}}));
} else if(a[0]==='run'&&a[1]==='jobs'&&a[2]==='get-iam-policy') {
 console.log(JSON.stringify({bindings:[{role:'roles/run.invoker',members:['serviceAccount:wally-account-scheduler@fixture.iam.gserviceaccount.com']}]}));
} else if(a[0]==='run'&&a[1]==='jobs'&&a[2]==='executions') console.log(process.env.ACTIVE?'[{"status":{}}]':'[]');
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
test('an enabled schedule is paused and verified before the worker is replaced', () => {
  const r = cleanup({ STATE: 'ENABLED', PAUSE_WORKS: '1' });
  assert.equal(r.status, 0, r.stderr);
  const pause = r.calls.findIndex((a) => a[0] === 'scheduler' && a.includes('pause'));
  const deploy = r.calls.findIndex((a) => a.includes('deploy'));
  assert.ok(pause >= 0 && deploy > pause);
});
test('a schedule that does not pause stops before worker replacement', () => {
  const r = cleanup({ STATE: 'ENABLED' });
  assert.notEqual(r.status, 0);
  assert.deepEqual(r.calls.filter(mutates), []);
});
test('the deployed worker is checked in --check mode after it is ready', () => {
  const r = cleanup();
  assert.equal(r.status, 0, r.stderr);
  const deploy = r.calls.findIndex((a) => a.includes('deploy'));
  const execute = r.calls.findIndex((a) => a.includes('execute'));
  assert.ok(deploy >= 0 && execute > deploy);
  assert.ok(r.calls[execute].includes('--args=dist/account-maintenance.js,--check'));
  assert.ok(r.calls[execute].includes('--wait'));
});
test('a failed worker check fails the script', () => {
  const r = cleanup({ CHECK_FAILS: '1' });
  assert.notEqual(r.status, 0);
});
test('an active execution that never finishes stops before worker replacement', () => {
  const r = cleanup({ ACTIVE: '1', CLEANUP_DRAIN_SECONDS: '0', CLEANUP_POLL_SECONDS: '0' });
  assert.notEqual(r.status, 0);
  assert.equal(
    r.calls.some((a) => a.includes('deploy')),
    false,
  );
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
