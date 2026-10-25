import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recoverRelease } from './recover-release.mjs';
import { existingDigest } from './resolve-release-image.mjs';
const state = {
  version: 1,
  project: 'fixture',
  region: 'europe-west1',
  revision: 'wally-api-old',
  hostingVersion: 'sites/fixture/versions/old',
  cleanup: null,
};
function runner(fail) {
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
test('recovery restores both targets after a failed publication', () => {
  const r = runner();
  recoverRelease(state, r.run);
  assert.ok(r.calls.some((c) => c.includes('--to-revisions=wally-api-old=100')));
  assert.ok(r.calls.some((c) => c.includes('POST')));
});
test('failed API recovery still attempts Hosting recovery and reports failure', () => {
  const r = runner((cmd, args) => args.includes('update-traffic'));
  assert.throws(() => recoverRelease(state, r.run), /restore API/);
  assert.ok(r.calls.some((c) => c.includes('POST')));
});
test('invalid snapshot performs no mutations', () => {
  const r = runner();
  assert.throws(() => recoverRelease({ ...state, hostingVersion: '' }, r.run));
  assert.equal(r.calls.length, 0);
});
test('unexpected Hosting readback cannot report recovery success', () => {
  const r = runner();
  assert.throws(
    () =>
      recoverRelease(state, (cmd, args) =>
        cmd === 'curl' && !args.includes('POST') ? '{}' : r.run(cmd, args),
      ),
    /not verified/,
  );
});
test('candidate digest is reused rather than rebuilt', () => {
  const digest = 'sha256:' + 'a'.repeat(64);
  assert.equal(
    existingDigest(
      [{ metadata: { name: 'candidate' }, spec: { containers: [{ image: 'repo@' + digest }] } }],
      'candidate',
      'repo',
    ),
    digest,
  );
});
test('candidate from a different repository stops retry', () =>
  assert.throws(() =>
    existingDigest(
      [
        {
          metadata: { name: 'candidate' },
          spec: { containers: [{ image: 'other@sha256:' + 'a'.repeat(64) }] },
        },
      ],
      'candidate',
      'repo',
    ),
  ));
test('absent candidate permits initial build', () =>
  assert.equal(existingDigest([], 'candidate', 'repo'), ''));
const cleanupState = {
  ...state,
  cleanup: {
    schedulerState: 'PAUSED',
    job: {
      spec: {
        template: { spec: { template: { spec: { containers: [{ image: 'repo@sha256:old' }] } } } },
      },
    },
  },
};
function cleanupRunner({ enabled = false, pauseFails = false, activeLists = 0 } = {}) {
  let paused = !enabled;
  let lists = 0;
  const calls = [];
  return {
    calls,
    run(cmd, args) {
      calls.push([cmd, ...args]);
      if (cmd === 'gcloud' && args[0] === 'scheduler') {
        if (args[2] === 'pause') {
          if (pauseFails || paused) throw new Error('pause rejected');
          paused = true;
          return '';
        }
        return JSON.stringify({ state: paused ? 'PAUSED' : 'ENABLED' });
      }
      if (cmd === 'gcloud' && args[0] === 'run' && args[1] === 'jobs') {
        if (args[2] === 'executions')
          return ++lists <= activeLists ? JSON.stringify([{ status: {} }]) : '[]';
        if (args[2] === 'describe') return JSON.stringify(cleanupState.cleanup.job);
        return '';
      }
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
test('cleanup recovery is idempotent when scheduler already paused', () => {
  const r = cleanupRunner();
  assert.doesNotThrow(() => recoverRelease(cleanupState, r.run));
  assert.equal(
    r.calls.some((a) => a[1] === 'scheduler' && a.includes('pause')),
    false,
  );
});
test('failed scheduler pause prohibits worker replacement but still restores API and Hosting', () => {
  const r = cleanupRunner({ enabled: true, pauseFails: true });
  assert.throws(() => recoverRelease(cleanupState, r.run), /pause/);
  assert.equal(
    r.calls.some((a) => a.includes('replace')),
    false,
  );
  assert.ok(r.calls.some((a) => a.includes('POST')));
  assert.ok(r.calls.some((a) => a.includes('update-traffic')));
});
test('retry rejects same revision with a different full commit', () => {
  const r = {
    metadata: { name: 'candidate', labels: { 'wally-commit': 'old' } },
    spec: { containers: [{ image: 'repo@sha256:' + 'a'.repeat(64) }] },
  };
  assert.throws(
    () => existingDigest([r], 'candidate', 'repo', { commit: 'new', config: {} }),
    /commit/,
  );
});
test('retry rejects changed configuration before deployment', () => {
  const r = {
    metadata: { name: 'candidate', labels: { 'wally-commit': 'same' } },
    spec: {
      serviceAccountName: 'worker',
      containers: [
        { image: 'repo@sha256:' + 'a'.repeat(64), env: [{ name: 'MCP_ENABLED', value: 'false' }] },
      ],
    },
  };
  assert.throws(
    () =>
      existingDigest([r], 'candidate', 'repo', {
        commit: 'same',
        config: { serviceAccountName: 'worker', env: [{ name: 'MCP_ENABLED', value: 'true' }] },
      }),
    /configuration/,
  );
});
const enabledState = {
  ...cleanupState,
  cleanup: { ...cleanupState.cleanup, schedulerState: 'ENABLED' },
};
function resumingRunner(options = {}) {
  const r = cleanupRunner({ enabled: true, ...options });
  let resumed = false;
  const run = (cmd, args) => {
    if (cmd === 'gcloud' && args[0] === 'scheduler' && args[2] === 'resume') {
      r.calls.push([cmd, ...args]);
      resumed = true;
      return '';
    }
    if (cmd === 'gcloud' && args[0] === 'scheduler' && args[2] === 'describe' && resumed) {
      r.calls.push([cmd, ...args]);
      return JSON.stringify({ state: 'ENABLED' });
    }
    return r.run(cmd, args);
  };
  return { calls: r.calls, run };
}
test('recovery resumes a schedule that was running before the release, after restoring the worker', () => {
  const r = resumingRunner();
  assert.match(recoverRelease(enabledState, r.run), /cleanup restored/);
  const replace = r.calls.findIndex((a) => a.includes('replace'));
  const resume = r.calls.findIndex((a) => a.includes('resume'));
  assert.ok(replace >= 0 && resume > replace);
});
test('recovery leaves the schedule paused when it was paused before the release', () => {
  const r = cleanupRunner();
  assert.match(recoverRelease(cleanupState, r.run), /remains paused/);
  assert.equal(
    r.calls.some((a) => a.includes('resume')),
    false,
  );
});
test('recovery waits for an execution the new worker started, then restores it', () => {
  const r = resumingRunner({ activeLists: 2 });
  let slept = 0;
  const result = recoverRelease(enabledState, r.run, {
    sleep: () => slept++,
    drainMs: 1000,
    clock: () => 0,
  });
  assert.match(result, /cleanup restored/);
  assert.equal(slept, 2);
  assert.ok(r.calls.some((a) => a.includes('replace')));
});
test('recovery leaves the schedule paused when an execution never finishes', () => {
  const r = cleanupRunner({ enabled: true, activeLists: 99 });
  let now = 0;
  assert.throws(
    () =>
      recoverRelease(enabledState, r.run, {
        sleep: () => (now += 500),
        drainMs: 1000,
        clock: () => now,
      }),
    /still active/,
  );
  assert.equal(
    r.calls.some((a) => a.includes('replace') || a.includes('resume')),
    false,
  );
});
test('recovery never resumes when the schedule could not be paused', () => {
  const r = cleanupRunner({ enabled: true, pauseFails: true });
  assert.throws(() => recoverRelease(enabledState, r.run), /pause/);
  assert.equal(
    r.calls.some((a) => a.includes('resume')),
    false,
  );
});
