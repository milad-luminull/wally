// Release rollback state. `snapshot` records what production serves before a release
// changes anything; `apply` puts it back after a failure past the traffic shift.
//   node scripts/release-state.mjs snapshot STATE.json
//   node scripts/release-state.mjs apply STATE.json [--workers]
// Wrangler reads CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID from the environment; neither
// is ever an argument, an output or part of the saved state.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const defaultRun = (command, args, input) =>
  execFileSync(command, args, { input, encoding: 'utf8', timeout: 120_000 });

/** The two Workers the release deploys, and the package whose wrangler.jsonc configures each. */
const WORKERS = { 'wally-api-proxy': '@wally/api-proxy', 'wally-web': '@wally/web' };
const VERSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const wrangler = (run, name, ...args) =>
  run('pnpm', ['--filter', WORKERS[name], 'exec', 'wrangler', ...args, '--name', name]);

/** The one version a Worker serves to all its traffic. */
function activeVersion(run, name) {
  let status;
  try {
    status = JSON.parse(wrangler(run, name, 'deployments', 'status', '--json'));
  } catch (error) {
    // `versions upload` refuses a Worker that does not exist (the Worker proof, check 9), so
    // a missing Worker would fail the release later anyway. Say why, before anything changes.
    if (`${error.message}\n${error.stderr ?? ''}`.includes('code: 10007'))
      throw new Error(
        `${name} does not exist. Create both Workers once before the first release ` +
          '(docs/DEPLOY.md, Cloudflare setup).',
      );
    throw error;
  }
  const serving = status.versions?.filter((v) => v.percentage > 0);
  if (
    serving?.length !== 1 ||
    serving[0].percentage !== 100 ||
    !VERSION_ID.test(serving[0].version_id)
  )
    throw new Error(`No single active version for ${name}`);
  return serving[0].version_id;
}

export function validateTargets(service, candidate) {
  const traffic = service.status?.traffic?.filter((t) => (t.percent ?? 0) > 0);
  if (traffic?.length !== 1 || traffic[0].percent !== 100 || !traffic[0].revisionName)
    throw new Error('No exact single serving API rollback revision');
  // A rerun after a failed recovery would otherwise record the candidate as its own
  // rollback target, and rolling back would change nothing.
  if (traffic[0].revisionName === candidate)
    throw new Error(
      `Production already serves the candidate ${candidate}. Restore the previous revision ` +
        "from the earlier run's release-state artifact before rerunning.",
    );
  return { revision: traffic[0].revisionName };
}

export function snapshotState(env, run = defaultRun) {
  const { GCP_PROJECT_ID: project, GCP_REGION: region, GITHUB_SHA: sha } = env;
  if (!project || !region) throw new Error('Missing project/region');
  if (!sha) throw new Error('Missing GITHUB_SHA');
  const service = JSON.parse(
    run('gcloud', [
      'run',
      'services',
      'describe',
      'wally-api',
      `--region=${region}`,
      `--project=${project}`,
      '--format=json',
    ]),
  );
  const { revision } = validateTargets(service, `wally-api-rel-${sha.slice(0, 7)}`);
  const workers = Object.fromEntries(
    Object.keys(WORKERS).map((name) => [name, activeVersion(run, name)]),
  );
  return { version: 2, project, region, revision, workers, commit: sha };
}

export function applyState(state, run = defaultRun, { workers }) {
  if (
    state.version !== 2 ||
    !/^[a-z][a-z0-9-]+$/.test(state.project || '') ||
    !/^[a-z]+-[a-z]+\d$/.test(state.region || '') ||
    !/^wally-api-[a-z0-9-]+$/.test(state.revision || '') ||
    !Object.keys(WORKERS).every((name) => VERSION_ID.test(state.workers?.[name] ?? ''))
  )
    throw new Error('Invalid recovery snapshot');
  const errors = [];
  const notes = [];
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
    notes.push('API restored.');
  });
  if (workers)
    for (const name of Object.keys(WORKERS))
      attempt(`restore ${name}`, () => {
        const target = state.workers[name];
        // The deploy step may have failed before it reached this Worker; rolling back to the
        // version already serving would change nothing, and Wrangler may refuse it.
        if (activeVersion(run, name) === target) {
          notes.push(`${name} was not changed.`);
          return;
        }
        wrangler(run, name, 'rollback', target, '--message', 'Release rollback', '-y');
        if (activeVersion(run, name) !== target) throw new Error(`${name} restore not verified`);
        notes.push(`${name} rolled back.`);
      });
  else notes.push('The Workers were never deployed.');
  if (errors.length) throw new Error(errors.join('\n'));
  return notes.join(' ');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [command, file, flag] = process.argv.slice(2);
    if (command === 'snapshot' && file) {
      const state = snapshotState(process.env);
      writeFileSync(file, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
      if (process.env.GITHUB_OUTPUT)
        appendFileSync(process.env.GITHUB_OUTPUT, `revision=${state.revision}\n`);
      console.log(`Cloud Run revision: ${state.revision}`);
      for (const [name, version] of Object.entries(state.workers))
        console.log(`${name}: ${version}`);
    } else if (command === 'apply' && file && (flag === undefined || flag === '--workers')) {
      const state = JSON.parse(readFileSync(file, 'utf8'));
      console.log(applyState(state, defaultRun, { workers: flag === '--workers' }));
    } else {
      throw new Error(
        'Usage: release-state.mjs snapshot STATE.json | apply STATE.json [--workers]',
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
