import { parseArgs } from 'node:util';
import { isDeepStrictEqual } from 'node:util';
import type { MigrationPlan, SourceUser } from './migration.js';

export function parseMigrationArgs(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      project: { type: 'string' },
      connection: { type: 'string' },
      output: { type: 'string' },
      plan: { type: 'string' },
      apply: { type: 'boolean', default: false },
      'confirm-project': { type: 'string' },
      uids: { type: 'string' },
    },
  });
  const command = positionals[0];
  if (
    positionals.length !== 1 ||
    !['export', 'verify', 'prepare-google'].includes(command ?? '') ||
    !values.project ||
    !values.connection
  ) {
    throw new Error(
      'Usage: auth-migrate.ts export|verify|prepare-google --project ID --connection NAME [--uids UID,UID] (--output NEW_DIRECTORY | --plan FILE) [--apply --confirm-project ID]',
    );
  }
  if (
    command === 'export' &&
    (!values.output || values.plan || values.apply || values['confirm-project'])
  )
    throw new Error('Export requires --output and cannot apply');
  if (command !== 'export' && (!values.plan || values.output))
    throw new Error('Verification requires --plan');
  if (values.apply && values['confirm-project'] !== values.project)
    throw new Error('Apply requires --confirm-project matching --project');
  const uids = values.uids?.split(',');
  if (uids?.some((uid) => !uid || uid.includes('/'))) throw new Error('Invalid selected UID');
  return {
    command,
    project: values.project,
    connection: values.connection,
    output: values.output,
    plan: values.plan,
    apply: values.apply,
    uids,
  };
}

interface AdminRecord {
  uid: string;
  email?: string;
  emailVerified: boolean;
  disabled: boolean;
  providerData: { providerId: string; uid: string }[];
}
export async function readMigrationSource(
  listUsers: (
    limit: number,
    pageToken?: string,
  ) => Promise<{ users: AdminRecord[]; pageToken?: string }>,
): Promise<SourceUser[]> {
  const users: SourceUser[] = [];
  let pageToken: string | undefined;
  const seen = new Set<string>();
  do {
    const page = await listUsers(1000, pageToken);
    for (const user of page.users)
      users.push({
        uid: user.uid,
        ...(user.email ? { email: user.email } : {}),
        emailVerified: user.emailVerified,
        disabled: user.disabled,
        providers: user.providerData.map(({ providerId, uid }) => ({ providerId, uid })),
      });
    pageToken = page.pageToken;
    if (pageToken && seen.has(pageToken)) throw new Error('Repeated Firebase pagination token');
    if (pageToken) seen.add(pageToken);
  } while (pageToken);
  return users;
}

export function assertReviewedPlan(fresh: MigrationPlan, reviewed: unknown): void {
  if (!isDeepStrictEqual(fresh, reviewed))
    throw new Error(
      'Reviewed plan differs from current trusted source. Export and review a new plan.',
    );
}

/** Leave headroom below Auth0's 500 KB upload limit; size is UTF-8 bytes. */
export function splitImportUsers(
  users: MigrationPlan['importUsers'],
  maxBytes = 450_000,
): string[] {
  const chunks: string[] = [];
  let current: MigrationPlan['importUsers'] = [];
  for (const user of users) {
    if (Buffer.byteLength(JSON.stringify([user])) > maxBytes)
      throw new Error('Import user exceeds chunk size');
    if (Buffer.byteLength(JSON.stringify([...current, user])) > maxBytes) {
      chunks.push(JSON.stringify(current));
      current = [];
    }
    current.push(user);
  }
  if (current.length) chunks.push(JSON.stringify(current));
  return chunks;
}

/** Selection happens after global ambiguity checks, so batching cannot hide conflicts. */
export function selectMigrationPlan(plan: MigrationPlan, uids?: string[]): MigrationPlan {
  if (!uids) return plan;
  const wanted = new Set(uids);
  const known = new Set([
    ...plan.identities.map((i) => i.userId),
    ...plan.issues.map((i) => i.userId),
  ]);
  if (uids.some((id) => !known.has(id))) throw new Error('Selected Firebase UID does not exist');
  return {
    ...plan,
    importUsers: plan.importUsers.filter((u) => wanted.has(u.app_metadata.wally_firebase_uid)),
    identities: plan.identities.filter((i) => wanted.has(i.userId)),
    issues: plan.issues.filter((i) => wanted.has(i.userId)),
  };
}
