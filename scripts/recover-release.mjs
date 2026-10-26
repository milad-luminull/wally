import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function recoverRelease(state, run) {
  if (
    state.version !== 1 ||
    !/^[a-z][a-z0-9-]+$/.test(state.project || '') ||
    !/^[a-z]+-[a-z]+\d$/.test(state.region || '') ||
    !/^wally-api-[a-z0-9-]+$/.test(state.revision || '') ||
    !state.hostingVersion?.startsWith(`sites/${state.project}/versions/`)
  )
    throw new Error('Invalid recovery snapshot');
  const errors = [];
  const attempt = (name, fn) => {
    try {
      fn();
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
    }
  };
  const cloud = (...args) =>
    run('gcloud', [...args, `--project=${state.project}`, `--region=${state.region}`]);
  attempt('restore API', () => {
    cloud('run', 'services', 'update-traffic', 'wally-api', `--to-revisions=${state.revision}=100`);
    const result = JSON.parse(cloud('run', 'services', 'describe', 'wally-api', '--format=json'));
    if (
      !result.status?.traffic?.some((t) => t.revisionName === state.revision && t.percent === 100)
    )
      throw new Error('API restore not verified');
  });
  attempt('restore Hosting', () => {
    const token = run('gcloud', ['auth', 'print-access-token']).trim();
    const base = `https://firebasehosting.googleapis.com/v1beta1/sites/${state.project}/releases`;
    run(
      'curl',
      [
        '--fail-with-body',
        '--silent',
        '--show-error',
        '--config',
        '-',
        '-X',
        'POST',
        '-H',
        'Content-Length: 0',
        `${base}?versionName=${encodeURIComponent(state.hostingVersion)}`,
      ],
      `header = "Authorization: Bearer ${token}"\nheader = "X-Goog-User-Project: ${state.project}"\n`,
    );
    const current = JSON.parse(
      run(
        'curl',
        ['--fail-with-body', '--silent', '--show-error', '--config', '-', `${base}?pageSize=1`],
        `header = "Authorization: Bearer ${token}"\nheader = "X-Goog-User-Project: ${state.project}"\n`,
      ),
    );
    if (current.releases?.[0]?.version?.name !== state.hostingVersion)
      throw new Error('Hosting restore not verified');
  });
  if (errors.length) throw new Error(errors.join('\n'));
  return 'API and Hosting restored.';
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] !== '--apply' || !process.argv[3])
      throw new Error('Usage: recover-release.mjs --apply STATE.json');
    console.log(
      recoverRelease(JSON.parse(readFileSync(process.argv[3], 'utf8')), (cmd, args, input) =>
        execFileSync(cmd, args, { input, encoding: 'utf8', timeout: 120_000 }),
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
