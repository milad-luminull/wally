import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
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
    AUTH0_ISSUER: 'https://login.luminull.com/',
    AUTH0_AUDIENCE: 'https://api.wally.luminull.com',
    MCP_ENABLED: env.MCP_ENABLED,
    MCP_WRITES_ENABLED: env.MCP_WRITES_ENABLED,
  };
  if (env.MCP_CLIENT_ID) values.MCP_CLIENT_ID = env.MCP_CLIENT_ID;
  if (Object.values(values).some((v) => typeof v !== 'string' || !v))
    throw new Error('Missing candidate configuration');
  return {
    serviceAccountName: `wally-api@${env.GCP_PROJECT_ID}.iam.gserviceaccount.com`,
    env: Object.entries(values)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, value]) => ({ name, value })),
  };
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
      env: [...(container?.env || [])].sort((a, b) => a.name.localeCompare(b.name)),
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
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { GCP_PROJECT_ID: p, GCP_REGION: r, GITHUB_SHA: sha, GITHUB_OUTPUT: out } = process.env;
    if (!p || !r || !sha || !out) throw new Error('Missing release identity');
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
    const digest = existingDigest(
      revisions,
      `wally-api-rel-${sha.slice(0, 7)}`,
      `${r}-docker.pkg.dev/${p}/wally/wally-api`,
      { commit: sha, config: apiConfig(process.env) },
    );
    appendFileSync(out, `digest=${digest}\n`);
    console.log(
      digest
        ? 'Reusing existing immutable candidate image'
        : 'No previous candidate; build required',
    );
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
