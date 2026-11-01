import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyState, snapshotState, validateTargets } from './release-state.mjs';

const env = {
  GCP_PROJECT_ID: 'fixture',
  GCP_REGION: 'europe-west1',
  GITHUB_SHA: 'abcdef0123456',
  GITHUB_REF_NAME: 'v0.13.0',
};
const PROXY_OLD = '11111111-1111-4111-8111-111111111111';
const WEB_OLD = '22222222-2222-4222-8222-222222222222';
const PROXY_NEW = '33333333-3333-4333-8333-333333333333';
const WEB_NEW = '44444444-4444-4444-8444-444444444444';
const state = {
  version: 2,
  project: 'fixture',
  region: 'europe-west1',
  revision: 'wally-api-old',
  workers: { 'wally-api-proxy': PROXY_OLD, 'wally-web': WEB_OLD },
};
const service = {
  status: {
    traffic: [
      { revisionName: 'wally-api-old', percent: 100 },
      { revisionName: 'wally-api-rel-abcdef0', tag: 'rel-abcdef0' },
    ],
  },
};

/** `wrangler deployments status --json` for one Worker serving one version. */
const deployment = (versionId, message = 'v0.12.0') =>
  JSON.stringify({
    id: 'd',
    annotations: { 'workers/message': message },
    versions: [{ version_id: versionId, percentage: 100 }],
  });

/** The Worker a Wrangler call names: `pnpm --filter <pkg> exec wrangler ... --name <name>`. */
const workerOf = (args) => args[args.indexOf('--name') + 1];

const missingWorker = () => {
  const error = new Error('Command failed: pnpm --filter @wally/web exec wrangler');
  error.stderr = 'This Worker does not exist on your account. [code: 10007]';
  return error;
};

function snapshotRunner({
  serving = service,
  workers = { 'wally-api-proxy': PROXY_OLD, 'wally-web': WEB_OLD },
  messages = {},
} = {}) {
  const calls = [];
  return {
    calls,
    run(cmd, args) {
      calls.push([cmd, ...args]);
      if (cmd === 'gcloud') return JSON.stringify(serving);
      const name = workerOf(args);
      if (!workers[name]) throw missingWorker();
      return deployment(workers[name], messages[name]);
    },
  };
}

/**
 * Wrangler as apply sees it: each Worker serves `active[name]` until a rollback moves it.
 * `fail` makes a call throw; `ignoreRollback` makes a rollback report success but change nothing.
 */
function applyRunner({
  active = { 'wally-api-proxy': PROXY_NEW, 'wally-web': WEB_NEW },
  fail,
  ignoreRollback,
} = {}) {
  const calls = [];
  const serving = { ...active };
  return {
    calls,
    run(cmd, args) {
      calls.push([cmd, ...args]);
      if (fail?.(cmd, args)) throw new Error('simulated failure');
      if (cmd === 'gcloud' && args.includes('describe'))
        return JSON.stringify({
          status: { traffic: [{ revisionName: state.revision, percent: 100 }] },
        });
      if (cmd === 'gcloud') return '';
      if (args.includes('rollback')) {
        if (!ignoreRollback) serving[workerOf(args)] = args[args.indexOf('rollback') + 1];
        return '';
      }
      return deployment(serving[workerOf(args)]);
    },
  };
}
const rollbacks = (calls) => calls.filter((c) => c.includes('rollback')).map(workerOf);

test('snapshot records the serving revision and each Worker version', () =>
  assert.deepEqual(snapshotState(env, snapshotRunner().run), {
    ...state,
    commit: env.GITHUB_SHA,
  }));
test('snapshot reads each Worker through its own package', () => {
  const r = snapshotRunner();
  snapshotState(env, r.run);
  const reads = r.calls.filter((c) => c[0] === 'pnpm');
  assert.deepEqual(
    reads.map((c) => c.slice(0, 5)),
    [
      ['pnpm', '--filter', '@wally/api-proxy', 'exec', 'wrangler'],
      ['pnpm', '--filter', '@wally/web', 'exec', 'wrangler'],
    ],
  );
  assert.ok(reads.every((c) => c.includes('deployments') && c.includes('--json')));
});
test('snapshot ignores no-traffic candidate tags', () =>
  assert.equal(validateTargets(service, 'wally-api-rel-abcdef0').revision, 'wally-api-old'));
test('snapshot rejects split traffic', () =>
  assert.throws(
    () =>
      validateTargets(
        {
          status: {
            traffic: [
              { revisionName: 'a', percent: 50 },
              { revisionName: 'b', percent: 50 },
            ],
          },
        },
        'x',
      ),
    /single/,
  ));
test('snapshot refuses when production already serves the candidate', () => {
  const serving = {
    status: { traffic: [{ revisionName: 'wally-api-rel-abcdef0', percent: 100 }] },
  };
  assert.throws(() => snapshotState(env, snapshotRunner({ serving }).run), /already serves/);
});
test('snapshot needs the commit to name the candidate', () =>
  assert.throws(
    () => snapshotState({ ...env, GITHUB_SHA: '' }, snapshotRunner().run),
    /GITHUB_SHA/,
  ));
test('denied snapshot read stops immediately without mutations', () => {
  const calls = [];
  assert.throws(
    () =>
      snapshotState(env, (cmd, args) => {
        calls.push(args);
        throw new Error('PERMISSION_DENIED');
      }),
    /PERMISSION_DENIED/,
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 3), ['run', 'services', 'describe']);
});
test('snapshot refuses when a Worker still serves this release after a failed recovery', () => {
  // The release deploys each Worker with its tag as the message, and a rollback replaces it.
  // A rerun that recorded the failed release's version would roll back to it.
  const r = snapshotRunner({ messages: { 'wally-web': 'v0.13.0' } });
  assert.throws(() => snapshotState(env, r.run), /wally-web already serves v0\.13\.0.*artifact/s);
});
test('snapshot accepts a Worker another release or a rollback deployed', () => {
  const r = snapshotRunner({
    messages: { 'wally-api-proxy': 'Release rollback', 'wally-web': 'v0.12.0' },
  });
  assert.equal(snapshotState(env, r.run).workers['wally-web'], WEB_OLD);
});
test('snapshot refuses, naming the setup step, when a Worker does not exist', () =>
  assert.throws(
    () => snapshotState(env, snapshotRunner({ workers: { 'wally-api-proxy': PROXY_OLD } }).run),
    /wally-web does not exist.*DEPLOY/s,
  ));
test('snapshot stops when a Worker read fails for any other reason', () =>
  assert.throws(
    () =>
      snapshotState(env, (cmd) => {
        if (cmd === 'gcloud') return JSON.stringify(service);
        throw new Error('Authentication error [code: 10000]');
      }),
    /Authentication error/,
  ));
test('snapshot rejects a Worker that is not on exactly one version', () =>
  assert.throws(
    () =>
      snapshotState(env, (cmd) =>
        cmd === 'gcloud'
          ? JSON.stringify(service)
          : JSON.stringify({
              versions: [
                { version_id: PROXY_OLD, percentage: 50 },
                { version_id: PROXY_NEW, percentage: 50 },
              ],
            }),
      ),
    /single/,
  ));

test('apply rolls back each Worker whose active version changed', () => {
  const r = applyRunner();
  assert.match(applyState(state, r.run, { workers: true }), /API restored/);
  assert.ok(r.calls.some((c) => c.includes('--to-revisions=wally-api-old=100')));
  assert.deepEqual(rollbacks(r.calls), ['wally-api-proxy', 'wally-web']);
  const proxyRollback = r.calls.find((c) => c.includes('rollback'));
  assert.equal(proxyRollback[proxyRollback.indexOf('rollback') + 1], PROXY_OLD);
  assert.ok(proxyRollback.includes('-y'));
});
test('apply skips a Worker still on its snapshot version', () => {
  const r = applyRunner({ active: { 'wally-api-proxy': PROXY_NEW, 'wally-web': WEB_OLD } });
  assert.match(applyState(state, r.run, { workers: true }), /wally-web was not changed/);
  assert.deepEqual(rollbacks(r.calls), ['wally-api-proxy']);
});
test('apply leaves Workers alone without --workers', () => {
  const r = applyRunner();
  assert.match(applyState(state, r.run, { workers: false }), /Workers were never deployed/);
  assert.ok(!r.calls.some((c) => c[0] === 'pnpm'));
});
test('failed API recovery still attempts Worker recovery and reports failure', () => {
  const r = applyRunner({ fail: (cmd, args) => args.includes('update-traffic') });
  assert.throws(() => applyState(state, r.run, { workers: true }), /restore API/);
  assert.deepEqual(rollbacks(r.calls), ['wally-api-proxy', 'wally-web']);
});
test('a failed Worker rollback still attempts the other and reports failure', () => {
  const r = applyRunner({
    fail: (cmd, args) => args.includes('rollback') && workerOf(args) === 'wally-api-proxy',
  });
  assert.throws(() => applyState(state, r.run, { workers: true }), /restore wally-api-proxy/);
  assert.ok(rollbacks(r.calls).includes('wally-web'));
});
test('unexpected Worker readback cannot report recovery success', () => {
  const r = applyRunner({ ignoreRollback: true });
  assert.throws(() => applyState(state, r.run, { workers: true }), /not verified/);
});
test('invalid snapshot performs no mutations', () => {
  for (const bad of [
    { ...state, version: 1, hostingVersion: 'sites/fixture/versions/old' },
    { ...state, workers: { ...state.workers, 'wally-web': 'not-a-version' } },
    { ...state, workers: { 'wally-api-proxy': PROXY_OLD } },
  ]) {
    const r = applyRunner();
    assert.throws(() => applyState(bad, r.run, { workers: true }), /Invalid recovery snapshot/);
    assert.equal(r.calls.length, 0);
  }
});
