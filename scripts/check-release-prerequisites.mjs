import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

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
  return { version: 1, project, region, commit: env.GITHUB_SHA || null, ...targets };
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
      }),
    );
    console.log('Read prerequisites passed.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
