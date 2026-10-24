import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
function run(overrides = {}, args = ['--apply']) {
  const dir = mkdtempSync(join(tmpdir(), 'bootstrap-test-'));
  const fake = `#!${process.execPath}
import {appendFileSync,writeFileSync,existsSync} from 'node:fs';
const a=process.argv.slice(2);appendFileSync(process.env.LOG,JSON.stringify(a)+'\\n');
if(a[0]==='scheduler'&&a[2]==='list') {
 if(process.env.DENIED){console.error('PERMISSION_DENIED');process.exit(1);}
 console.log(JSON.stringify(process.env.EXISTS?[{name:'projects/fixture/locations/europe-west1/jobs/wally-account-cleanup'}]:[]));
} else if(a[0]==='scheduler'&&a[2]==='pause')writeFileSync(process.env.PAUSED,'yes');
else if(a[0]==='scheduler'&&a[2]==='describe') console.log(process.env.EXISTS||existsSync(process.env.PAUSED)?'PAUSED':'ENABLED');
`;
  writeFileSync(join(dir, 'gcloud'), fake);
  chmodSync(join(dir, 'gcloud'), 0o755);
  const r = spawnSync('bash', ['scripts/bootstrap-account-cleanup.sh', ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      LOG: join(dir, 'log'),
      PAUSED: join(dir, 'paused'),
      GCP_PROJECT_ID: 'fixture',
      GCP_REGION: 'europe-west1',
      ...overrides,
    },
  });
  let calls = [];
  try {
    calls = readFileSync(join(dir, 'log'), 'utf8').trim().split('\n').map(JSON.parse);
  } catch {}
  rmSync(dir, { recursive: true, force: true });
  return { ...r, calls };
}
test('bootstrap requires explicit operator apply', () => {
  const r = run({}, []);
  assert.notEqual(r.status, 0);
  assert.equal(r.calls.length, 0);
});
test('denied scheduler inventory cannot start bootstrap mutations', () => {
  const r = run({ DENIED: '1' });
  assert.notEqual(r.status, 0);
  assert.equal(
    r.calls.some((a) =>
      ['create', 'update', 'pause', 'add-iam-policy-binding'].some((v) => a.includes(v)),
    ),
    false,
  );
});
test('new schedule cannot execute cleanup before verified pause', () => {
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  const creation = r.calls.find((a) => a.includes('create'));
  assert.ok(creation.includes('--http-method=GET'));
  assert.ok(creation.some((a) => a.startsWith('--uri=') && !a.endsWith(':run')));
  const pause = r.calls.findIndex((a) => a.includes('pause'));
  const update = r.calls.findIndex((a) => a[0] === 'scheduler' && a.includes('update'));
  assert.ok(pause >= 0 && update > pause);
  assert.ok(r.calls[update].includes('--http-method=POST'));
});
test('bootstrap reuses an existing paused schedule', () => {
  const r = run({ EXISTS: '1' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(
    r.calls.some((a) => a.includes('create') || a.includes('pause')),
    false,
  );
});
