import { buildApp } from './app.js';
import { loadEnv } from './env.js';
import { purgeExpired, schedulePurge } from './lib/db/purge.js';

async function main() {
  const env = loadEnv();
  const app = await buildApp();

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // Expired receipts, audit and assistant records, hourly (what Firestore's TTL did).
  const stopPurge = schedulePurge({
    intervalMs: 3_600_000,
    purge: (now) => purgeExpired(app.db, now),
    log: { info: (fields) => app.log.info(fields), warn: (fields) => app.log.warn(fields) },
  });

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down`);
    stopPurge();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
