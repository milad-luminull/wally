import { buildApp } from './app.js';
import { loadEnv } from './env.js';
import { processLogger } from './lib/logging/index.js';

async function main() {
  const env = loadEnv();
  const app = await buildApp();

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.fatal({ err }, 'API failed to listen');
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

// Before the app exists there is no app logger: the same options, for the process.
main().catch((err) => {
  processLogger().fatal({ err }, 'API failed to start');
  process.exit(1);
});
