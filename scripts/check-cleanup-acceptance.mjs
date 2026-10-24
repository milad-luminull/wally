import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Includes all files copied into the API build and its dependency manifests.
// Release/docs-only changes can preserve a previously tested worker image.
export function sourceFingerprint(run = execFileSync) {
  return createHash('sha256')
    .update(
      run(
        'git',
        [
          'ls-tree',
          'HEAD',
          'apps/api',
          'apps/web/package.json',
          'packages/shared',
          'packages/config',
          'pnpm-lock.yaml',
          'pnpm-workspace.yaml',
          'package.json',
          '.dockerignore',
        ],
        { encoding: 'utf8' },
      ),
    )
    .digest('hex');
}
export function validateAcceptance(evidence, env, fingerprint, now = Date.now()) {
  const checked = Date.parse(evidence.checkedAt);
  if (
    evidence.version !== 1 ||
    evidence.sourceFingerprint !== fingerprint ||
    !Number.isFinite(checked) ||
    checked > now ||
    now - checked > 24 * 60 * 60 * 1000
  )
    throw new Error('Cleanup acceptance is stale or belongs to different worker source');
  const prefix = `${env.GCP_REGION}-docker.pkg.dev/${env.GCP_PROJECT_ID}/wally/wally-api@`;
  if (
    typeof evidence.image !== 'string' ||
    !evidence.image.startsWith(prefix) ||
    !/^sha256:[a-f0-9]{64}$/.test(evidence.image.slice(prefix.length))
  )
    throw new Error('Cleanup acceptance lacks exact worker image digest');
  if (
    evidence.project !== env.GCP_PROJECT_ID ||
    evidence.database !== 'wally' ||
    evidence.workerServiceAccount !==
      `wally-account-cleanup@${env.GCP_PROJECT_ID}.iam.gserviceaccount.com` ||
    evidence.secretVersion !== env.AUTH0_CLEANUP_SECRET_VERSION ||
    evidence.auth0ClientId !== env.AUTH0_CLEANUP_CLIENT_ID ||
    evidence.auth0ManagementDomain !== env.AUTH0_MANAGEMENT_DOMAIN
  )
    throw new Error('Cleanup acceptance configuration mismatch');
  const checks = [
    'workerDatabaseAccess',
    'workerSecretAccess',
    'auth0DeleteUsersScope',
    'firebaseFixtureDeletion',
    'auth0FixtureDeletion',
    'idempotentRetry',
  ];
  if (
    checks.some((c) => evidence.checks?.[c] !== true) ||
    typeof evidence.evidenceUrl !== 'string' ||
    !evidence.evidenceUrl.startsWith('https://github.com/milad-luminull/wally/')
  )
    throw new Error('Cleanup acceptance lacks required fixture evidence');
  return evidence.image;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    let evidence;
    try {
      evidence = JSON.parse(
        readFileSync(
          process.env.ACCOUNT_CLEANUP_ACCEPTANCE_FILE || 'infra/account-cleanup-acceptance.json',
          'utf8',
        ),
      );
    } catch {
      throw new Error(
        'Verified cleanup acceptance is required. Record actual worker/provider fixture results before release; do not substitute empty-queue readiness.',
      );
    }
    const image = validateAcceptance(evidence, process.env, sourceFingerprint());
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `image=${image}\n`);
    console.log(`Accepted worker evidence: ${evidence.evidenceUrl}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
