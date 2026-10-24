import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const workflow = (await import('node:fs')).readFileSync('.github/workflows/release.yml', 'utf8');
const block = workflow
  .split('      - name: Wait for composite indexes to finish building\n')[1]
  .split('\n      #')[0];
const command = block
  .split('        run: |\n')[1]
  .split('\n')
  .map((l) => l.replace(/^          /, ''))
  .join('\n');
function run(body) {
  const d = mkdtempSync(join(tmpdir(), 'wally-index-test-'));
  writeFileSync(join(d, 'gcloud'), '#!/bin/sh\n' + body);
  chmodSync(join(d, 'gcloud'), 0o755);
  const r = spawnSync('bash', ['-c', command], {
    encoding: 'utf8',
    timeout: 3000,
    env: { ...process.env, GCP_PROJECT_ID: 'fixture', PATH: d + ':' + process.env.PATH },
  });
  rmSync(d, { recursive: true, force: true });
  return r;
}
test('workflow index waiter rejects denied list instead of reporting READY', () => {
  const r = run('echo PERMISSION_DENIED >&2; exit 1');
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.stdout, /all indexes READY/);
});
test('workflow index waiter rejects malformed response', () => {
  const r = run('echo corrupt-response');
  assert.notEqual(r.status, 0);
  assert.equal(r.error, undefined);
});
const { waitForIndexes, indexesReady } = await import('./wait-firestore-indexes.mjs');
const expected = [
  {
    collectionGroup: 'notes',
    queryScope: 'COLLECTION',
    fields: [{ fieldPath: 'boardId', order: 'ASCENDING' }],
  },
];
const ready = {
  name: 'projects/p/databases/wally/collectionGroups/notes/indexes/a',
  state: 'READY',
  queryScope: 'COLLECTION',
  fields: [
    { fieldPath: 'boardId', order: 'ASCENDING' },
    { fieldPath: '__name__', order: 'ASCENDING' },
  ],
};
test('empty inventory cannot satisfy declared indexes', () =>
  assert.equal(indexesReady([], expected), false));
test('waits for expected index to become ready', async () => {
  let calls = 0;
  await waitForIndexes({
    expected,
    read: () => [{ ...ready, state: ++calls === 1 ? 'CREATING' : 'READY' }],
    sleep: async () => {},
    attempts: 2,
  });
  assert.equal(calls, 2);
});
test('pending indexes time out', async () =>
  assert.rejects(
    waitForIndexes({ expected, read: () => [], sleep: async () => {}, attempts: 2 }),
    /not READY/,
  ));
test('repair state fails immediately', () =>
  assert.throws(() => indexesReady([{ ...ready, state: 'NEEDS_REPAIR' }], expected), /repair/));
