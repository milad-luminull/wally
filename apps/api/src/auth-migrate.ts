import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getAuth } from 'firebase-admin/auth';
import { getDb } from './lib/db/client.js';
import { loadEnv } from './env.js';
import { getFirebaseApp } from './lib/firebase-app.js';
import { bindImportedIdentity } from './lib/auth/identities.js';
import { buildMigrationPlan, executeMigration } from './lib/auth/migration.js';
import {
  assertReviewedPlan,
  parseMigrationArgs,
  readMigrationSource,
  selectMigrationPlan,
  splitImportUsers,
} from './lib/auth/migration-cli.js';

// No import, password reset, account linking, or Auth0 write endpoint is called here.
const args = parseMigrationArgs(process.argv.slice(2));
const app = getFirebaseApp();
if (
  loadEnv().FIREBASE_PROJECT_ID !== args.project ||
  (app.options.projectId && app.options.projectId !== args.project)
)
  throw new Error('Firebase project does not match --project');
const db = getDb();
try {
  const auth = getAuth(app);
  const users = await readMigrationSource((limit, token) => auth.listUsers(limit, token));
  const wallyIds = (await db.collection('users').select().get()).docs.map((doc) => doc.id);
  const plan = selectMigrationPlan(
    buildMigrationPlan(args.project, args.connection, users, wallyIds),
    args.uids,
  );
  if (args.command === 'export') {
    // New directory only. Existing reviewed exports cannot be overwritten accidentally.
    await mkdir(args.output!, { mode: 0o700 });
    await writeFile(join(args.output!, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
    const chunks = splitImportUsers(plan.importUsers);
    for (const [index, chunk] of chunks.entries())
      await writeFile(
        join(args.output!, `users-${String(index + 1).padStart(4, '0')}.json`),
        `${chunk}\n`,
        { mode: 0o600, flag: 'wx' },
      );
    process.stdout.write(
      `${JSON.stringify({ dryRun: true, importFiles: chunks.length, identities: plan.identities.length, quarantinedUsers: plan.issues.length })}\n`,
    );
  } else {
    assertReviewedPlan(plan, JSON.parse(await readFile(args.plan!, 'utf8')));
    const token = process.env.AUTH0_MIGRATION_TOKEN;
    if (!token) throw new Error('AUTH0_MIGRATION_TOKEN with read:users is required');
    const reports = await executeMigration(
      plan,
      async (subject) => {
        // Fixed tenant origin, exact subject lookup, no email search and no redirects.
        const url = new URL(`api/v2/users/${encodeURIComponent(subject)}`, plan.issuer);
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          redirect: 'error',
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok)
          throw new Error(`Auth0 verification failed (${response.status}); no mappings applied`);
        return response.json();
      },
      (identity, userId) => bindImportedIdentity(db, identity, userId),
      args.apply,
    );
    process.stdout.write(
      `${JSON.stringify({ dryRun: !args.apply, quarantinedUsers: plan.issues.length, reports })}\n`,
    );
    if (reports.some((r) => r.status === 'failed')) process.exitCode = 1;
  }
} finally {
  await db.terminate();
}
