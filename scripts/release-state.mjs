// Release rollback state. `snapshot` records what production serves before a release
// changes anything; `apply` puts it back after a failure past the traffic shift.
//   node scripts/release-state.mjs snapshot STATE.json
//   node scripts/release-state.mjs apply STATE.json [--hosting]
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const defaultRun = (command, args, input) =>
  execFileSync(command, args, { input, encoding: 'utf8', timeout: 120_000 });

// Pass credentials through stdin, never an argument, output or saved artifact.
function hostingApi(run, project) {
  const token = run('gcloud', ['auth', 'print-access-token']).trim();
  const config = `header = "Authorization: Bearer ${token}"\nheader = "X-Goog-User-Project: ${project}"\n`;
  const base = `https://firebasehosting.googleapis.com/v1beta1/sites/${project}/releases`;
  const curl = (...args) =>
    run('curl', ['--fail-with-body', '--silent', '--show-error', '--config', '-', ...args], config);
  return {
    latest: () => JSON.parse(curl(`${base}?pageSize=1`)),
    release: (version) =>
      curl(
        '-X',
        'POST',
        '-H',
        'Content-Length: 0',
        `${base}?versionName=${encodeURIComponent(version)}`,
      ),
  };
}

export function validateTargets(service, hosting, project, candidate) {
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
  const version = hosting.releases?.[0]?.version?.name;
  if (
    typeof version !== 'string' ||
    !version.startsWith(`sites/${project}/versions/`) ||
    version.endsWith('/')
  )
    throw new Error('Missing Hosting rollback version');
  return { revision: traffic[0].revisionName, hostingVersion: version };
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
  const targets = validateTargets(
    service,
    hostingApi(run, project).latest(),
    project,
    `wally-api-rel-${sha.slice(0, 7)}`,
  );
  return { version: 1, project, region, ...targets, commit: sha };
}

export function applyState(state, run = defaultRun, { hosting }) {
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
  if (hosting)
    attempt('restore Hosting', () => {
      const api = hostingApi(run, state.project);
      api.release(state.hostingVersion);
      if (api.latest().releases?.[0]?.version?.name !== state.hostingVersion)
        throw new Error('Hosting restore not verified');
    });
  if (errors.length) throw new Error(errors.join('\n'));
  return hosting ? 'API and Hosting restored.' : 'API restored; Hosting was never deployed.';
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
      console.log(`Hosting version:    ${state.hostingVersion}`);
    } else if (command === 'apply' && file && (flag === undefined || flag === '--hosting')) {
      const state = JSON.parse(readFileSync(file, 'utf8'));
      console.log(applyState(state, defaultRun, { hosting: flag === '--hosting' }));
    } else {
      throw new Error(
        'Usage: release-state.mjs snapshot STATE.json | apply STATE.json [--hosting]',
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
