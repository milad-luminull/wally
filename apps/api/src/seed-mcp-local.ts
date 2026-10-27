import { readFile } from 'node:fs/promises';
import { getDb } from './lib/db/client.js';
import { seedMcpLocal } from './lib/auth/local-mcp-seed.js';

const path = process.argv[2];
if (!path)
  throw new Error(
    'Supply a private JSON file containing the exact reviewed Auth0 subject and email',
  );
const input = JSON.parse(await readFile(path, 'utf8')) as { subject: string; email: string };
const db = getDb();
try {
  await seedMcpLocal(db, input);
  console.log('Synthetic local MCP boards ready; no MCP client is connected.');
} finally {
  await db.terminate();
}
