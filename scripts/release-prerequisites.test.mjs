import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
test('missing Hosting rollback version is explicitly rejected', () =>
  assert.match(workflow, /\[ -n "\$HV" \]/));
test('traffic activation selects the exact candidate', () => {
  assert.doesNotMatch(workflow, /--to-latest/);
  assert.match(workflow, /--to-revisions=/);
});
test('partial failed traffic command still triggers recovery', () => {
  assert.doesNotMatch(workflow, /steps\.shift\.outcome == 'success'/);
  assert.match(workflow, /steps\.shift\.outcome != 'skipped'/);
});
test('manual dispatch cannot reach deploy job', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /deploy:\n    if: github.event_name == 'push'/);
});
const { validateTargets, inspectPrerequisites } = await import('./check-release-prerequisites.mjs');
const service = {
  status: {
    traffic: [
      { revisionName: 'old', percent: 100 },
      { revisionName: 'candidate', tag: 'candidate' },
    ],
  },
};
const hosting = { releases: [{ version: { name: 'sites/fixture/versions/old' } }] };
test('snapshot rejects empty Hosting releases', () =>
  assert.throws(() => validateTargets(service, { releases: [] }, 'fixture'), /Hosting/));
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
      ),
    /single/,
  ));
test('snapshot ignores no-traffic candidate tags', () =>
  assert.equal(validateTargets(service, hosting, 'fixture').revision, 'old'));
test('denied preflight read stops immediately without mutations', () => {
  const calls = [];
  assert.throws(
    () =>
      inspectPrerequisites({ GCP_PROJECT_ID: 'fixture', GCP_REGION: 'eu' }, (cmd, args) => {
        calls.push(args);
        throw new Error('PERMISSION_DENIED');
      }),
    /PERMISSION_DENIED/,
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 3), ['run', 'services', 'describe']);
});
