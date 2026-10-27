// The API candidate: its one runtime configuration, and the image a retry may reuse.
//   node scripts/resolve-release-image.mjs          before deploying: digest, run_env, service_account
//   node scripts/resolve-release-image.mjs verify   after deploying: the candidate matches (needs DIGEST)
//   node scripts/resolve-release-image.mjs platform after building: the linux/amd64 digest of the
//                                                   image index on stdin
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// The only definition of the API's runtime environment. The deploy flag is built from it,
// and both the retry check and the post-deploy check compare the revision against it.
export function apiConfig(env) {
  const values = {
    FIREBASE_PROJECT_ID: env.GCP_PROJECT_ID,
    NODE_ENV: 'production',
    CORS_ORIGIN: env.WEB_ORIGIN,
    FIRESTORE_DATABASE_ID: 'wally',
    ASSISTANT_ENABLED: env.ASSISTANT_ENABLED,
    ASSISTANT_MODEL: env.ASSISTANT_MODEL,
    ASSISTANT_VERTEX_LOCATION: env.ASSISTANT_VERTEX_LOCATION,
    AUTH0_ENABLED: env.AUTH0_ENABLED,
    AUTH0_SIGNUP_ENABLED: env.AUTH0_SIGNUP_ENABLED,
    MCP_ENABLED: env.MCP_ENABLED,
    MCP_WRITES_ENABLED: env.MCP_WRITES_ENABLED,
  };
  if (env.MCP_CLIENT_ID) values.MCP_CLIENT_ID = env.MCP_CLIENT_ID;
  if (Object.values(values).some((v) => typeof v !== 'string' || !v))
    throw new Error('Missing candidate configuration');
  if (Object.values(values).some((v) => /[@\r\n]/.test(v)))
    throw new Error('Candidate configuration value contains the @ delimiter or a newline');
  if (!/^[a-z-]+:[^:]+$/.test(values.ASSISTANT_MODEL))
    throw new Error('ASSISTANT_MODEL must look like provider:model');
  return {
    serviceAccountName: `wally-api@${env.GCP_PROJECT_ID}.iam.gserviceaccount.com`,
    env: Object.entries(values)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, value]) => ({ name, value })),
  };
}

// ^@^ picks @ as gcloud's delimiter so a value containing a comma cannot silently split
// into two variables. --set-env-vars REPLACES the whole set: the workflow, not deploy
// history, is the source of truth.
export function runEnvFlag(config) {
  return '^@^' + config.env.map(({ name, value }) => `${name}=${value}`).join('@');
}

export function existingDigest(revisions, name, repository, expected) {
  if (!Array.isArray(revisions)) throw new Error('Invalid revision inventory');
  const matches = revisions.filter((r) => r.metadata?.name === name);
  if (matches.length > 1) throw new Error('Ambiguous candidate revision');
  if (!matches.length) return '';
  const revision = matches[0];
  if (expected) {
    if (revision.metadata?.labels?.['wally-commit'] !== expected.commit)
      throw new Error('Existing candidate full commit mismatch');
    const container = revision.spec?.containers?.[0];
    const actual = {
      serviceAccountName: revision.spec?.serviceAccountName,
      env: (container?.env || [])
        .map(({ name, value }) => ({ name, value }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
    if (
      JSON.stringify(actual) !== JSON.stringify(expected.config) ||
      container?.command ||
      container?.args
    )
      throw new Error(
        'Existing candidate configuration mismatch; refusing immutable revision update',
      );
  }
  const image = revision.spec?.containers?.[0]?.image;
  if (
    typeof image !== 'string' ||
    !image.startsWith(repository + '@sha256:') ||
    !/^sha256:[a-f0-9]{64}$/.test(image.split('@')[1])
  )
    throw new Error('Existing candidate image is not the expected immutable repository digest');
  return image.split('@')[1];
}

// The build pushes an image index (the image plus its provenance and SBOM attestations), and
// build-push-action reports the index digest. Cloud Run resolves an index to its linux/amd64
// image and records that image's digest on the revision, so the release deploys and verifies
// that digest, never the index's.
export function platformDigest(index) {
  if (!Array.isArray(index?.manifests)) throw new Error('Built image is not an image index');
  const images = index.manifests.filter(
    (m) => m.platform?.os === 'linux' && m.platform?.architecture === 'amd64',
  );
  if (images.length !== 1)
    throw new Error(`Expected one linux/amd64 image, found ${images.length}`);
  const { digest } = images[0];
  if (!/^sha256:[a-f0-9]{64}$/.test(digest ?? '')) throw new Error('Invalid linux/amd64 digest');
  return digest;
}

export function verifyCandidate(revisions, name, repository, expected, digest) {
  const actual = existingDigest(revisions, name, repository, expected);
  if (!actual) throw new Error(`Candidate revision ${name} not found`);
  if (actual !== digest) throw new Error(`Candidate runs ${actual}, expected digest ${digest}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] === 'platform') {
      console.log(platformDigest(JSON.parse(readFileSync(0, 'utf8'))));
      process.exit();
    }
    const { GCP_PROJECT_ID: p, GCP_REGION: r, GITHUB_SHA: sha, GITHUB_OUTPUT: out } = process.env;
    if (!p || !r || !sha || !out) throw new Error('Missing release identity');
    const command = process.argv[2] ?? 'resolve';
    if (!['resolve', 'verify'].includes(command))
      throw new Error('Usage: resolve-release-image.mjs [resolve | verify]');
    const config = apiConfig(process.env);
    const revisions = JSON.parse(
      execFileSync(
        'gcloud',
        [
          'run',
          'revisions',
          'list',
          '--service=wally-api',
          `--project=${p}`,
          `--region=${r}`,
          '--format=json',
        ],
        { encoding: 'utf8', timeout: 60_000 },
      ),
    );
    const args = [
      revisions,
      `wally-api-rel-${sha.slice(0, 7)}`,
      `${r}-docker.pkg.dev/${p}/wally/wally-api`,
      { commit: sha, config },
    ];
    if (command === 'verify') {
      verifyCandidate(...args, process.env.DIGEST);
      console.log('Candidate runs the selected image with exactly the release configuration');
    } else {
      const digest = existingDigest(...args);
      appendFileSync(
        out,
        `digest=${digest}\nrun_env=${runEnvFlag(config)}\nservice_account=${config.serviceAccountName}\n`,
      );
      console.log(
        digest
          ? 'Reusing existing immutable candidate image'
          : 'No previous candidate; build required',
      );
    }
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
