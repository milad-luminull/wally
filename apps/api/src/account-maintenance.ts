import { getDb } from './lib/db/client.js';
import { processAccountDeletion } from './lib/account/cleanup.js';
import { deletionProviders } from './lib/account/providers.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const check = args.includes('--check');
const target = args.find((arg) => arg.startsWith('--user='))?.slice(7);
if (
  (check && args.length !== 1) ||
  args.some(
    (arg) =>
      arg !== '--apply' && arg !== '--status' && arg !== '--check' && !arg.startsWith('--user='),
  )
)
  throw new Error('Usage: account-maintenance [--status | --apply | --check] [--user=WALLY_ID]');
const db = getDb();
function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing worker configuration: ${name}`);
  return value;
}
const providerConfig = () => ({
  issuer: required('AUTH0_ISSUER'),
  managementDomain: required('AUTH0_MANAGEMENT_DOMAIN'),
  clientId: required('AUTH0_CLEANUP_CLIENT_ID'),
  clientSecret: required('AUTH0_CLEANUP_CLIENT_SECRET'),
});
async function runCheck() {
  // Run by the release against the freshly deployed worker: the same image, identity,
  // database and secret the schedule will use. Reads one job and deletes nothing.
  await db.collection('accountDeletionJobs').limit(1).get();
  const { auth0Scope } = await deletionProviders(providerConfig()).verifyAccess();
  process.stdout.write(
    `${JSON.stringify({ check: 'ok', database: 'readable', firebase: 'delete authorized', auth0Scope })}\n`,
  );
}
async function runJobs() {
  const query = db.collection('accountDeletionJobs');
  const jobs = target
    ? [await query.doc(target).get()]
    : (await query.where('status', '!=', 'complete').get()).docs;
  const providers =
    apply && jobs.some((job) => job.exists && job.data()?.status !== 'complete')
      ? deletionProviders(providerConfig())
      : null;
  for (const job of jobs) {
    if (!job.exists) continue;
    const status =
      apply && providers ? await processAccountDeletion(db, job.id, providers) : job.data()!.status;
    process.stdout.write(
      `${JSON.stringify({ job: job.id, status, phase: job.data()?.phase, attempts: job.data()?.attempts })}\n`,
    );
    if (apply && status !== 'complete') process.exitCode = 1;
  }
}
try {
  await (check ? runCheck() : runJobs());
} finally {
  await db.terminate();
}
