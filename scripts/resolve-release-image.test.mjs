import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  apiConfig,
  existingDigest,
  platformDigest,
  runEnvFlag,
  verifyCandidate,
} from './resolve-release-image.mjs';

const digest = 'sha256:' + 'a'.repeat(64);
const releaseEnv = {
  GCP_PROJECT_ID: 'fixture',
  WEB_ORIGIN: 'https://wally.example',
  ASSISTANT_ENABLED: 'false',
  ASSISTANT_MODEL: 'vertex:gemini-3.8-flash',
  ASSISTANT_VERTEX_LOCATION: 'eu',
  AUTH0_ENABLED: 'true',
  AUTH0_SIGNUP_ENABLED: 'false',
  MCP_ENABLED: 'false',
  MCP_WRITES_ENABLED: 'false',
};
const candidate = (config, image = 'repo@' + digest) => ({
  metadata: { name: 'candidate', labels: { 'wally-commit': 'same' } },
  spec: {
    serviceAccountName: config.serviceAccountName,
    containers: [{ image, env: config.env.map(({ name, value }) => ({ value, name })) }],
  },
});

test('candidate digest is reused rather than rebuilt', () => {
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
      [{ metadata: { name: 'candidate' }, spec: { containers: [{ image: 'other@' + digest }] } }],
      'candidate',
      'repo',
    ),
  ));
test('absent candidate permits initial build', () =>
  assert.equal(existingDigest([], 'candidate', 'repo'), ''));
test('retry rejects same revision with a different full commit', () => {
  const r = {
    metadata: { name: 'candidate', labels: { 'wally-commit': 'old' } },
    spec: { containers: [{ image: 'repo@' + digest }] },
  };
  assert.throws(
    () => existingDigest([r], 'candidate', 'repo', { commit: 'new', config: {} }),
    /commit/,
  );
});
test('retry rejects changed configuration before deployment', () => {
  const config = apiConfig(releaseEnv);
  const changed = apiConfig({ ...releaseEnv, MCP_ENABLED: 'true', MCP_CLIENT_ID: 'client' });
  assert.throws(
    () =>
      existingDigest([candidate(config)], 'candidate', 'repo', { commit: 'same', config: changed }),
    /configuration/,
  );
});

test('the deploy flag carries exactly the configuration the checks expect', () => {
  const config = apiConfig(releaseEnv);
  const flag = runEnvFlag(config);
  assert.ok(flag.startsWith('^@^'));
  const parsed = flag
    .slice(3)
    .split('@')
    .map((pair) => {
      const [name, ...value] = pair.split('=');
      return { name, value: value.join('=') };
    });
  assert.deepEqual(parsed, config.env);
  assert.ok(parsed.some((e) => e.name === 'FIRESTORE_DATABASE_ID' && e.value === 'wally'));
  assert.ok(!parsed.some((e) => e.name === 'MCP_CLIENT_ID'));
});
test('the configuration sets exactly the variables the API reads in production', () =>
  assert.deepEqual(
    apiConfig({ ...releaseEnv, MCP_CLIENT_ID: 'client' }).env.map(({ name }) => name),
    [
      'ASSISTANT_ENABLED',
      'ASSISTANT_MODEL',
      'ASSISTANT_VERTEX_LOCATION',
      'AUTH0_ENABLED',
      'AUTH0_SIGNUP_ENABLED',
      'CORS_ORIGIN',
      'FIREBASE_PROJECT_ID',
      'FIRESTORE_DATABASE_ID',
      'MCP_CLIENT_ID',
      'MCP_ENABLED',
      'MCP_WRITES_ENABLED',
      'NODE_ENV',
    ],
  ));
test('configuration rejects a value that would split the deploy flag', () =>
  assert.throws(() => apiConfig({ ...releaseEnv, WEB_ORIGIN: 'https://a@b' }), /delimiter/));
test('configuration rejects a malformed assistant model', () =>
  assert.throws(() => apiConfig({ ...releaseEnv, ASSISTANT_MODEL: 'gemini' }), /ASSISTANT_MODEL/));
test('configuration rejects a missing value', () =>
  assert.throws(() => apiConfig({ ...releaseEnv, WEB_ORIGIN: '' }), /Missing/));

test('deployed candidate passes when image and configuration match', () => {
  const config = apiConfig(releaseEnv);
  verifyCandidate([candidate(config)], 'candidate', 'repo', { commit: 'same', config }, digest);
});
test('deployed candidate with an extra variable fails', () => {
  const config = apiConfig(releaseEnv);
  const r = candidate({
    ...config,
    env: [...config.env, { name: 'FIRESTORE_EMULATOR_HOST', value: 'x' }],
  });
  assert.throws(
    () => verifyCandidate([r], 'candidate', 'repo', { commit: 'same', config }, digest),
    /configuration/,
  );
});
test('deployed candidate with another image fails', () => {
  const config = apiConfig(releaseEnv);
  const r = candidate(config, 'repo@sha256:' + 'b'.repeat(64));
  assert.throws(
    () => verifyCandidate([r], 'candidate', 'repo', { commit: 'same', config }, digest),
    /digest/,
  );
});
test('missing deployed candidate fails', () =>
  assert.throws(
    () => verifyCandidate([], 'candidate', 'repo', { commit: 'same', config: {} }, digest),
    /not found/,
  ));

const index = (manifests) => ({ mediaType: 'application/vnd.oci.image.index.v1+json', manifests });
const amd64 = { digest, platform: { os: 'linux', architecture: 'amd64' } };
const attestation = {
  digest: 'sha256:' + 'c'.repeat(64),
  platform: { os: 'unknown', architecture: 'unknown' },
  annotations: { 'vnd.docker.reference.type': 'attestation-manifest' },
};
test('the release image is the linux/amd64 image inside the built index', () =>
  assert.equal(platformDigest(index([amd64, attestation])), digest));
test('an index without a linux/amd64 image stops the release', () =>
  assert.throws(() => platformDigest(index([attestation])), /found 0/));
test('a single-image manifest is not taken for an index', () =>
  assert.throws(() => platformDigest({ config: {}, layers: [] }), /not an image index/));
