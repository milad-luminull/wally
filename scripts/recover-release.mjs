import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  const scheduler = (verb) =>
    run('gcloud', [
      'scheduler',
      'jobs',
      verb,
      'wally-account-cleanup',
      `--project=${state.project}`,
      `--location=${state.region}`,
    ]);
  let cleanupPaused = false;
  let workerRestored = false;
  let cleanupResumed = false;
  const readScheduler = () =>
    JSON.parse(
      run('gcloud', [
        'scheduler',
        'jobs',
        'describe',
        'wally-account-cleanup',
        `--project=${state.project}`,
        `--location=${state.region}`,
        '--format=json',
      ]),
    );
  if (state.cleanup)
    attempt('pause cleanup', () => {
      if (readScheduler().state !== 'PAUSED') {
        // A transport error can happen after the server applied the pause.
        let pauseError;
        try {
          scheduler('pause');
        } catch (error) {
          pauseError = error;
        }
        if (readScheduler().state !== 'PAUSED')
          throw pauseError || new Error('scheduler not PAUSED');
      }
      cleanupPaused = true;
    });
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
  if (state.cleanup && cleanupPaused)
    attempt('restore worker', () => {
      const executions = JSON.parse(
        cloud('run', 'jobs', 'executions', 'list', '--job=wally-account-cleanup', '--format=json'),
      );
      if (!Array.isArray(executions) || executions.some((e) => !e.status?.completionTime))
        throw new Error('cleanup execution still active; manual inspection required');
      const dir = mkdtempSync(join(tmpdir(), 'wally-recover-'));
      try {
        const file = join(dir, 'job.json');
        writeFileSync(file, JSON.stringify(state.cleanup.job), { mode: 0o600 });
        cloud('run', 'jobs', 'replace', file);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      const job = JSON.parse(
        cloud('run', 'jobs', 'describe', 'wally-account-cleanup', '--format=json'),
      );
      if (
        job.spec?.template?.spec?.template?.spec?.containers?.[0]?.image !==
        state.cleanup.job.spec.template.spec.template.spec.containers[0].image
      )
        throw new Error('worker image restore not verified');
      workerRestored = true;
    });
  // The schedule was running before this release, and the worker is back on the exact
  // configuration it ran then, so put the schedule back too. Any failure above leaves it
  // paused for inspection.
  if (state.cleanup?.schedulerState === 'ENABLED' && workerRestored && !errors.length)
    attempt('resume cleanup', () => {
      scheduler('resume');
      if (readScheduler().state !== 'ENABLED') throw new Error('scheduler not ENABLED');
      cleanupResumed = true;
    });
  if (errors.length) throw new Error(errors.join('\n'));
  return cleanupResumed || !state.cleanup
    ? 'API, Hosting and cleanup restored.'
    : 'API and Hosting restored; cleanup remains paused. Inspect pending deletions before resuming.';
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
