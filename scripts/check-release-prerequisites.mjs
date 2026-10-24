import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function validateCleanup({ scheduler, policy, job, executions, ttl }, project, region) {
  const account = `wally-account-scheduler@${project}.iam.gserviceaccount.com`;
  const uri = `https://run.googleapis.com/v2/projects/${project}/locations/${region}/jobs/wally-account-cleanup:run`;
  if (
    scheduler.state !== 'PAUSED' ||
    scheduler.schedule !== '*/5 * * * *' ||
    scheduler.timeZone !== 'Etc/UTC' ||
    scheduler.httpTarget?.uri !== uri ||
    scheduler.httpTarget?.httpMethod !== 'POST' ||
    scheduler.httpTarget?.oauthToken?.serviceAccountEmail !== account
  )
    throw new Error('Cleanup scheduler must be correctly configured and PAUSED');
  if (
    !policy.bindings?.some(
      (b) =>
        b.role === 'roles/run.invoker' &&
        !b.condition &&
        b.members?.includes(`serviceAccount:${account}`),
    )
  )
    throw new Error('Missing unconditional scheduler invocation binding on cleanup job');
  if (!Array.isArray(executions) || executions.some((e) => !e.status?.completionTime))
    throw new Error('Cleanup execution active or invalid inventory');
  const template = job.spec?.template?.spec?.template?.spec;
  if (
    template?.serviceAccountName !== `wally-account-cleanup@${project}.iam.gserviceaccount.com` ||
    !job.status?.conditions?.some((c) => c.type === 'Ready' && c.status === 'True')
  )
    throw new Error('Cleanup worker identity/readiness invalid');
  if (
    !Array.isArray(ttl) ||
    !ttl.some(
      (t) =>
        t.name ===
          `projects/${project}/databases/wally/collectionGroups/accountDeletionJobs/fields/expiresAt` &&
        t.ttlConfig?.state === 'ACTIVE',
    )
  )
    throw new Error('Completed account deletion job TTL is not ACTIVE');
}
export function validateTargets(service, hosting, project) {
  const traffic = service.status?.traffic?.filter((t) => (t.percent ?? 0) > 0);
  if (traffic?.length !== 1 || traffic[0].percent !== 100 || !traffic[0].revisionName)
    throw new Error('No exact single serving API rollback revision');
  const version = hosting.releases?.[0]?.version?.name;
  if (
    typeof version !== 'string' ||
    !version.startsWith(`sites/${project}/versions/`) ||
    version.endsWith('/')
  )
    throw new Error('Missing Hosting rollback version');
  return { revision: traffic[0].revisionName, hostingVersion: version };
}
export function inspectPrerequisites(
  env,
  run = (command, args, input) =>
    execFileSync(command, args, { input, encoding: 'utf8', timeout: 60_000 }),
) {
  const project = env.GCP_PROJECT_ID,
    region = env.GCP_REGION;
  if (!project || !region) throw new Error('Missing project/region');
  const cloud = (...args) =>
    JSON.parse(run('gcloud', [...args, `--project=${project}`, '--format=json']));
  const service = cloud('run', 'services', 'describe', 'wally-api', `--region=${region}`);
  // Pass credentials through stdin, never an argument, output or saved artifact.
  const token = run('gcloud', ['auth', 'print-access-token']).trim();
  const hosting = JSON.parse(
    run(
      'curl',
      [
        '--fail-with-body',
        '--silent',
        '--show-error',
        '--config',
        '-',
        `https://firebasehosting.googleapis.com/v1beta1/sites/${project}/releases?pageSize=1`,
      ],
      `header = "Authorization: Bearer ${token}"\nheader = "X-Goog-User-Project: ${project}"\n`,
    ),
  );
  const targets = validateTargets(service, hosting, project);
  const indexes = cloud('firestore', 'indexes', 'composite', 'list', '--database=wally');
  if (!Array.isArray(indexes)) throw new Error('Invalid index inventory');
  let cleanup = null;
  if (env.AUTH0_ENABLED === 'true') {
    const scheduler = cloud(
      'scheduler',
      'jobs',
      'describe',
      'wally-account-cleanup',
      `--location=${region}`,
    );
    const policy = cloud(
      'run',
      'jobs',
      'get-iam-policy',
      'wally-account-cleanup',
      `--region=${region}`,
    );
    const job = cloud('run', 'jobs', 'describe', 'wally-account-cleanup', `--region=${region}`);
    const executions = cloud(
      'run',
      'jobs',
      'executions',
      'list',
      '--job=wally-account-cleanup',
      `--region=${region}`,
    );
    const ttl = cloud('firestore', 'fields', 'ttls', 'list', '--database=wally');
    validateCleanup({ scheduler, policy, job, executions, ttl }, project, region);
    const worker = job.spec.template.spec.template.spec;
    const container = worker.containers?.[0];
    const allowed = new Set([
      'NODE_ENV',
      'FIREBASE_PROJECT_ID',
      'FIRESTORE_DATABASE_ID',
      'AUTH0_ISSUER',
      'AUTH0_MANAGEMENT_DOMAIN',
      'AUTH0_CLEANUP_CLIENT_ID',
      'AUTH0_CLEANUP_CLIENT_SECRET',
    ]);
    if (
      !container ||
      worker.containers.length !== 1 ||
      container.env?.some(
        (e) => !allowed.has(e.name) || (e.name === 'AUTH0_CLEANUP_CLIENT_SECRET' && !e.valueFrom),
      )
    )
      throw new Error('Unexpected worker configuration; snapshot refused');
    const values = Object.fromEntries((container.env || []).map((e) => [e.name, e.value]));
    const reference = container.env?.find((e) => e.name === 'AUTH0_CLEANUP_CLIENT_SECRET')
      ?.valueFrom?.secretKeyRef;
    if (
      values.NODE_ENV !== 'production' ||
      values.FIREBASE_PROJECT_ID !== project ||
      values.FIRESTORE_DATABASE_ID !== 'wally' ||
      values.AUTH0_ISSUER !== 'https://login.luminull.com/' ||
      values.AUTH0_MANAGEMENT_DOMAIN !== env.AUTH0_MANAGEMENT_DOMAIN ||
      values.AUTH0_CLEANUP_CLIENT_ID !== env.AUTH0_CLEANUP_CLIENT_ID ||
      `${reference?.name}:${reference?.key}` !== env.AUTH0_CLEANUP_SECRET_VERSION ||
      JSON.stringify(container.command) !== JSON.stringify(['node']) ||
      JSON.stringify(container.args) !== JSON.stringify(['dist/account-maintenance.js', '--apply'])
    )
      throw new Error(
        'Worker command, database or credential references do not match release settings',
      );
    cleanup = {
      schedulerState: scheduler.state,
      job: {
        apiVersion: 'run.googleapis.com/v1',
        kind: 'Job',
        metadata: { name: 'wally-account-cleanup', namespace: project },
        spec: job.spec,
      },
    };
  }
  return { version: 1, project, region, commit: env.GITHUB_SHA || null, ...targets, cleanup };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = inspectPrerequisites(process.env, (cmd, args, input) =>
      execFileSync(cmd, args, { input, encoding: 'utf8', timeout: 60_000 }),
    );
    if (process.argv[2])
      writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    console.log(
      JSON.stringify({
        revision: report.revision,
        hostingVersion: report.hostingVersion,
        cleanupPrepared: !!report.cleanup,
      }),
    );
    console.log(
      'Read prerequisites passed; write permissions and provider deletion are separate acceptance checks.',
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
