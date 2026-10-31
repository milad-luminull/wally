import { loadEnv } from './env.js';
import { createDatabase } from './lib/postgres/client.js';
import { drainCleanup } from './lib/commands/maintenance.js';
import { purgeExpired } from './lib/db/purge.js';
import { boardCleanup } from './lib/postgres/schema/index.js';

const args = new Set(process.argv.slice(2));
if ([...args].some((arg) => arg !== '--cleanup'))
  throw new Error('Usage: pnpm maintenance [--cleanup]');
const { db, close } = createDatabase(loadEnv().DATABASE_URL);
try {
  // Expired receipts, audit and assistant records always go; cleanup jobs only with --cleanup.
  const purged = await purgeExpired(db);
  const cleanup = args.has('--cleanup')
    ? await drainCleanup(db)
    : { pending: await db.$count(boardCleanup) };
  process.stdout.write(`${JSON.stringify({ purged, cleanup })}\n`);
  if (args.has('--cleanup') && cleanup.pending > 0) process.exitCode = 1;
} finally {
  await close();
}
