import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const mapping = {
  metadata: { name: 'api.wally.luminull.com', generation: 1 },
  spec: { routeName: 'wally-api' },
  status: {
    observedGeneration: 1,
    mappedRouteName: 'wally-api',
    conditions: [{ type: 'Ready', status: 'True' }],
  },
};
function run(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'api-domain-'));
  const log = join(dir, 'calls');
  const fake = `#!${process.execPath}
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.CALL_LOG, JSON.stringify(args) + '\\n');
if (process.argv[1].endsWith('gcloud')) {
  if (process.env.GCLOUD_FAIL) process.exit(1);
  process.stdout.write(process.env.MAPPING);
} else if (args.includes('-X')) {
  if (process.env.CORS_RESPONSE) { process.stdout.write(process.env.CORS_RESPONSE); process.exit(0); }
  process.stdout.write('HTTP/2 ' + (process.env.CORS_STATUS || '204') + '\\r\\nAccess-Control-Allow-Origin: ' + (process.env.ALLOW_ORIGIN || process.env.WEB_ORIGIN) + '\\r\\nAccess-Control-Allow-Methods: GET, POST, PATCH, DELETE\\r\\nAccess-Control-Allow-Headers: authorization, content-type\\r\\n\\r\\n');
} else if (args.at(-1).endsWith('/health')) {
  if (process.env.CURL_FAIL) process.exit(60);
  process.stdout.write(process.env.HEALTH || '{"status":"ok"}');
} else process.stdout.write(process.env.AUTH_STATUS || '401');
`;
  for (const cmd of ['gcloud', 'curl']) {
    writeFileSync(join(dir, cmd), fake);
    chmodSync(join(dir, cmd), 0o755);
  }
  const result = spawnSync(process.execPath, ['scripts/check-api-domain.mjs'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      CALL_LOG: log,
      API_BASE_URL: 'https://api.wally.luminull.com',
      WEB_ORIGIN: 'https://wally.luminull.com',
      GCP_PROJECT_ID: 'luminull-wally',
      GCP_REGION: 'europe-west1',
      MAPPING: JSON.stringify(mapping),
      ...overrides,
    },
  });
  let calls = [];
  try {
    calls = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
  } catch {
    // Validation failures are expected to return before any command creates the log.
  }
  rmSync(dir, { recursive: true, force: true });
  return { ...result, calls };
}
test('accepts ready mapping with healthy API and intended CORS origin', () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls[0], [
    'beta',
    'run',
    'domain-mappings',
    'describe',
    '--domain=api.wally.luminull.com',
    '--project=luminull-wally',
    '--region=europe-west1',
    '--format=json',
  ]);
  assert.equal(result.calls.length, 4);
});
for (const url of [
  'https://api.wally.luminull.com/',
  'http://api.wally.luminull.com',
  'https://old.run.app',
  'https://api.wally.luminull.com/path',
  'https://api.wally.luminull.com?x=1',
  '$(touch /tmp/injected)',
]) {
  test(`rejects noncanonical API URL ${url} before calling commands`, () => {
    const result = run({ API_BASE_URL: url });
    assert.notEqual(result.status, 0);
    assert.equal(result.calls.length, 0);
  });
}
for (const [name, overrides] of Object.entries({
  'wrong web origin': { WEB_ORIGIN: 'https://luminull-wally.web.app' },
  'missing project': { GCP_PROJECT_ID: '' },
  'missing region': { GCP_REGION: '' },
  'missing mapping': { GCLOUD_FAIL: '1' },
  'wrong service': { MAPPING: JSON.stringify({ ...mapping, spec: { routeName: 'other' } }) },
  'wrong current route': {
    MAPPING: JSON.stringify({
      ...mapping,
      status: { ...mapping.status, mappedRouteName: 'other' },
    }),
  },
  'wrong domain': {
    MAPPING: JSON.stringify({
      ...mapping,
      metadata: { ...mapping.metadata, name: 'other.example' },
    }),
  },
  'not ready': {
    MAPPING: JSON.stringify({
      ...mapping,
      status: { ...mapping.status, conditions: [{ type: 'Ready', status: 'False' }] },
    }),
  },
  'stale readiness': {
    MAPPING: JSON.stringify({ ...mapping, status: { ...mapping.status, observedGeneration: 0 } }),
  },
  'bad health': { HEALTH: '{"status":"bad"}' },
  'invalid health JSON': { HEALTH: '<html>error</html>' },
  'TLS failure': { CURL_FAIL: '1' },
  'unprotected API': { AUTH_STATUS: '200' },
  'redirected CORS': { CORS_STATUS: '302' },
  'wrong CORS origin': { ALLOW_ORIGIN: 'https://other.example' },
  'wildcard CORS': { ALLOW_ORIGIN: '*' },
  'missing CORS headers': { CORS_RESPONSE: 'HTTP/2 204\r\n\r\n' },
  'missing CORS method': {
    CORS_RESPONSE:
      'HTTP/2 204\r\nAccess-Control-Allow-Origin: https://wally.luminull.com\r\nAccess-Control-Allow-Headers: authorization,content-type\r\n\r\n',
  },
  'missing authorization allowance': {
    CORS_RESPONSE:
      'HTTP/2 204\r\nAccess-Control-Allow-Origin: https://wally.luminull.com\r\nAccess-Control-Allow-Methods: GET\r\nAccess-Control-Allow-Headers: content-type\r\n\r\n',
  },
  'missing mapping status': { MAPPING: JSON.stringify({ ...mapping, status: {} }) },
  'invalid mapping response': { MAPPING: '{}' },
})) {
  test(`rejects ${name}`, () => {
    const result = run(overrides);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /API domain check failed:/);
  });
}
