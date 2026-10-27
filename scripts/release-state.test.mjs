import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyState, snapshotState, validateTargets } from './release-state.mjs';

const env = { GCP_PROJECT_ID: 'fixture', GCP_REGION: 'europe-west1', GITHUB_SHA: 'abcdef0123456' };
const state = {
  version: 1,
  project: 'fixture',
  region: 'europe-west1',
  revision: 'wally-api-old',
  hostingVersion: 'sites/fixture/versions/old',
};
const service = {
  status: {
    traffic: [
      { revisionName: 'wally-api-old', percent: 100 },
      { revisionName: 'wally-api-rel-abcdef0', tag: 'rel-abcdef0' },
    ],
  },
};
const hosting = { releases: [{ version: { name: 'sites/fixture/versions/old' } }] };

function snapshotRunner(serving = service) {
  const calls = [];
  return {
    calls,
    run(cmd, args) {
      calls.push([cmd, ...args]);
      if (cmd === 'gcloud' && args.includes('describe')) return JSON.stringify(serving);
      if (cmd === 'gcloud') return 'token\n';
      return JSON.stringify(hosting);
    },
  };
}

function applyRunner(fail) {
  const calls = [];
  return {
    calls,
    run(cmd, args) {
      calls.push([cmd, ...args]);
      if (fail?.(cmd, args)) throw new Error('simulated failure');
      if (cmd === 'gcloud' && args.includes('describe'))
        return JSON.stringify({
          status: { traffic: [{ revisionName: state.revision, percent: 100 }] },
        });
      if (cmd === 'curl' && !args.includes('POST'))
        return JSON.stringify({ releases: [{ version: { name: state.hostingVersion } }] });
      return '';
    },
  };
}

test('snapshot records the serving revision and Hosting version', () =>
  assert.deepEqual(snapshotState(env, snapshotRunner().run), { ...state, commit: env.GITHUB_SHA }));
test('snapshot ignores no-traffic candidate tags', () =>
  assert.equal(
    validateTargets(service, hosting, 'fixture', 'wally-api-rel-abcdef0').revision,
    'wally-api-old',
  ));
test('snapshot rejects empty Hosting releases', () =>
  assert.throws(() => validateTargets(service, { releases: [] }, 'fixture', 'x'), /Hosting/));
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
        hosting,
        'fixture',
        'x',
      ),
    /single/,
  ));
test('snapshot refuses when production already serves the candidate', () => {
  const serving = {
    status: { traffic: [{ revisionName: 'wally-api-rel-abcdef0', percent: 100 }] },
  };
  assert.throws(() => snapshotState(env, snapshotRunner(serving).run), /already serves/);
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
test('snapshot no longer lists Firestore indexes', () => {
  const r = snapshotRunner();
  snapshotState(env, r.run);
  assert.ok(!r.calls.some((c) => c.includes('indexes')));
});

test('apply restores both targets when Hosting was deployed', () => {
  const r = applyRunner();
  applyState(state, r.run, { hosting: true });
  assert.ok(r.calls.some((c) => c.includes('--to-revisions=wally-api-old=100')));
  assert.ok(r.calls.some((c) => c.includes('POST')));
});
test('apply leaves Hosting alone when Hosting was never deployed', () => {
  const r = applyRunner();
  assert.match(applyState(state, r.run, { hosting: false }), /API restored/);
  assert.ok(r.calls.some((c) => c.includes('--to-revisions=wally-api-old=100')));
  assert.ok(!r.calls.some((c) => c[0] === 'curl'));
});
test('failed API recovery still attempts Hosting recovery and reports failure', () => {
  const r = applyRunner((cmd, args) => args.includes('update-traffic'));
  assert.throws(() => applyState(state, r.run, { hosting: true }), /restore API/);
  assert.ok(r.calls.some((c) => c.includes('POST')));
});
test('invalid snapshot performs no mutations', () => {
  const r = applyRunner();
  assert.throws(() => applyState({ ...state, hostingVersion: '' }, r.run, { hosting: true }));
  assert.equal(r.calls.length, 0);
});
test('unexpected Hosting readback cannot report recovery success', () => {
  const r = applyRunner();
  assert.throws(
    () =>
      applyState(
        state,
        (cmd, args) => (cmd === 'curl' && !args.includes('POST') ? '{}' : r.run(cmd, args)),
        { hosting: true },
      ),
    /not verified/,
  );
});
