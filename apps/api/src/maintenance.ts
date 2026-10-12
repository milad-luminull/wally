import { getDb } from './lib/db/client.js';
import { drainCleanup, reconcileBoards } from './lib/commands/maintenance.js';

const args = new Set(process.argv.slice(2));
if ([...args].some((arg) => !['--apply', '--cleanup'].includes(arg)))
  throw new Error('Usage: pnpm maintenance [--apply] [--cleanup]');
const db = getDb();
try {
  const repairs = await reconcileBoards(db, args.has('--apply'));
  const cleanup = args.has('--cleanup')
    ? await drainCleanup(db)
    : { pending: (await db.collection('boardCleanup').get()).size };
  process.stdout.write(`${JSON.stringify({ dryRun: !args.has('--apply'), repairs, cleanup })}\n`);
  if (args.has('--cleanup') && cleanup.pending > 0) process.exitCode = 1;
} finally {
  await db.terminate();
}
