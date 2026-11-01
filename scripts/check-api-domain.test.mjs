import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const PREVIEW = 'https://3f7c7cd4-wally-api-proxy.luminull.workers.dev';
function run(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'api-domain-'));
  const log = join(dir, 'calls');
  const fake = `#!${process.execPath}
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
const name = process.argv[1].split('/').at(-1);
appendFileSync(process.env.CALL_LOG, JSON.stringify([name, ...args]) + '\\n');
if (name === 'gcloud') process.exit(1);
else if (args.includes('-X')) {
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
const urls = (calls) => calls.map((call) => call.at(-1));

test('passes on health, 401 and CORS without reading any domain mapping', () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /API health, authentication and CORS checks passed/);
  assert.ok(result.calls.every(([name]) => name === 'curl'));
  assert.deepEqual(urls(result.calls), [
    'https://api.wally.luminull.com/health',
    'https://api.wally.luminull.com/whiteboards',
    'https://api.wally.luminull.com/whiteboards',
  ]);
});
test('needs no Google Cloud project or region', () => {
  const result = run({ GCP_PROJECT_ID: '', GCP_REGION: '' });
  assert.equal(result.status, 0, result.stderr);
});
test('probes CHECK_URL when set, still requiring the canonical API_BASE_URL', () => {
  const result = run({ CHECK_URL: PREVIEW });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(urls(result.calls), [
    `${PREVIEW}/health`,
    `${PREVIEW}/whiteboards`,
    `${PREVIEW}/whiteboards`,
  ]);
  const wrongBase = run({ CHECK_URL: PREVIEW, API_BASE_URL: 'https://old.run.app' });
  assert.notEqual(wrongBase.status, 0);
  assert.equal(wrongBase.calls.length, 0);
});
for (const url of [
  'http://3f7c7cd4-wally-api-proxy.luminull.workers.dev',
  `${PREVIEW}/`,
  `${PREVIEW}/path`,
  `${PREVIEW}?x=1`,
  '$(touch /tmp/injected)',
]) {
  test(`rejects CHECK_URL ${url} before calling commands`, () => {
    const result = run({ CHECK_URL: url });
    assert.notEqual(result.status, 0);
    assert.equal(result.calls.length, 0);
  });
}
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
})) {
  test(`rejects ${name}`, () => {
    const result = run(overrides);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /API domain check failed:/);
  });
}
