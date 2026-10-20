import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../errors.js';
import type { ExternalIdentity } from './identities.js';

export interface SourceUser {
  uid: string;
  email?: string;
  emailVerified: boolean;
  disabled: boolean;
  providers: { providerId: string; uid: string }[];
}
export interface MigrationIdentity {
  userId: string;
  subject: string;
  provider: 'auth0' | 'google-oauth2';
  providerId: string;
}
export interface MigrationPlan {
  version: 1;
  issuer: 'https://login.luminull.com/';
  project: string;
  connection: string;
  importUsers: {
    user_id: string;
    email: string;
    email_verified: boolean;
    app_metadata: {
      wally_firebase_uid: string;
      wally_firebase_project: string;
      wally_password_reset_required: true;
    };
  }[];
  identities: MigrationIdentity[];
  issues: { userId: string; reasons: string[] }[];
}

/** Accept only a projection from trusted Admin records, never a client/email lookup. */
export function buildMigrationPlan(
  project: string,
  connection: string,
  users: SourceUser[],
  wallyIds: string[],
): MigrationPlan {
  if (!project || !connection) throw new Error('Project and database connection are required');
  const result: MigrationPlan = {
    version: 1,
    issuer: 'https://login.luminull.com/',
    project,
    connection,
    importUsers: [],
    identities: [],
    issues: [],
  };
  const existing = new Set(wallyIds);
  const counts = (values: string[]) => {
    const map = new Map<string, number>();
    for (const value of values) map.set(value, (map.get(value) ?? 0) + 1);
    return map;
  };
  const uidCounts = counts(users.map((u) => u.uid));
  const emails = counts(users.flatMap((u) => (u.email ? [u.email.toLowerCase()] : [])));
  const googleIds = counts(
    users.flatMap((u) =>
      u.providers.filter((p) => p.providerId === 'google.com').map((p) => p.uid),
    ),
  );
  for (const user of [...users].sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0))) {
    const reasons: string[] = [];
    if (!user.uid || user.uid.includes('/') || uidCounts.get(user.uid) !== 1)
      reasons.push('invalid-or-duplicate-uid');
    if (!existing.has(user.uid)) reasons.push('missing-wally-user');
    if (user.disabled) reasons.push('disabled-source');
    if (!z.string().email().safeParse(user.email).success) reasons.push('missing-or-invalid-email');
    if (user.email && (emails.get(user.email.toLowerCase()) ?? 0) > 1)
      reasons.push('duplicate-email');
    if (
      !user.providers.length ||
      user.providers.some((p) => !['password', 'google.com'].includes(p.providerId))
    )
      reasons.push('unsupported-provider');
    if (new Set(user.providers.map((p) => p.providerId)).size !== user.providers.length)
      reasons.push('duplicate-provider');
    const google = user.providers.find((p) => p.providerId === 'google.com');
    if (google && (!google.uid || googleIds.get(google.uid) !== 1))
      reasons.push('ambiguous-google-subject');
    if (reasons.length) {
      result.issues.push({ userId: user.uid, reasons });
      continue;
    }
    if (user.providers.some((p) => p.providerId === 'password')) {
      const id = `wally-firebase-${createHash('sha256')
        .update(JSON.stringify([project, user.uid]))
        .digest('hex')}`;
      result.importUsers.push({
        user_id: id,
        email: user.email!,
        email_verified: user.emailVerified,
        app_metadata: {
          wally_firebase_uid: user.uid,
          wally_firebase_project: project,
          wally_password_reset_required: true,
        },
      });
      result.identities.push({
        userId: user.uid,
        subject: `auth0|${id}`,
        provider: 'auth0',
        providerId: id,
      });
    }
    if (google)
      result.identities.push({
        userId: user.uid,
        subject: `google-oauth2|${google.uid}`,
        provider: 'google-oauth2',
        providerId: google.uid,
      });
  }
  return result;
}

const evidenceSchema = z.object({
  user_id: z.string(),
  blocked: z.boolean().optional(),
  identities: z.array(
    z.object({ provider: z.string(), user_id: z.string(), connection: z.string() }),
  ),
  app_metadata: z.record(z.unknown()).optional(),
});

/** Evidence must come directly from the configured tenant's authenticated Management API. */
export function verifyMigrationIdentity(
  plan: MigrationPlan,
  identity: MigrationIdentity,
  raw: unknown,
): void {
  const evidence = evidenceSchema.parse(raw);
  if (
    evidence.blocked ||
    evidence.user_id !== identity.subject ||
    !evidence.identities.some(
      (i) =>
        i.provider === identity.provider &&
        i.user_id === identity.providerId &&
        i.connection === (identity.provider === 'auth0' ? plan.connection : 'google-oauth2'),
    )
  ) {
    throw new Error('Auth0 subject/provider/connection evidence mismatch');
  }
  if (
    identity.provider === 'auth0' &&
    (evidence.app_metadata?.wally_firebase_uid !== identity.userId ||
      evidence.app_metadata?.wally_firebase_project !== plan.project ||
      evidence.app_metadata?.wally_password_reset_required !== true)
  )
    throw new Error('Auth0 trusted source metadata mismatch');
}

export interface MigrationReport {
  userId: string;
  subject: string;
  status: 'verified' | 'bound' | 'failed';
  errorCode?: string;
}
/** Preflight the entire batch, then use the transactional immutable binding for resumability. */
export async function executeMigration(
  plan: MigrationPlan,
  readUser: (subject: string) => Promise<unknown>,
  bind: (identity: ExternalIdentity, userId: string) => Promise<void>,
  apply = false,
): Promise<MigrationReport[]> {
  for (const identity of plan.identities)
    verifyMigrationIdentity(plan, identity, await readUser(identity.subject));
  const report: MigrationReport[] = [];
  for (const identity of plan.identities) {
    let status: MigrationReport['status'] = 'verified';
    let errorCode: string | undefined;
    if (apply) {
      try {
        await bind({ issuer: plan.issuer, subject: identity.subject }, identity.userId);
        status = 'bound';
      } catch (error) {
        status = 'failed';
        errorCode =
          error instanceof AppError && ['IDENTITY_CONFLICT', 'USER_NOT_FOUND'].includes(error.code)
            ? error.code
            : 'MAPPING_WRITE_FAILED';
      }
    }
    report.push({
      userId: identity.userId,
      subject: identity.subject,
      status,
      ...(errorCode ? { errorCode } : {}),
    });
  }
  return report;
}
