// Operator-only acceptance fixture for the account-cleanup worker. Never called by CI or
// the release. It creates ONE disposable identity (Auth0 + disabled Firebase + a Wally
// user, board and private note), queues its deletion, and afterwards checks what the
// worker left behind. Runbook: docs/ACCOUNT_CONTROLS_RELEASE.md, "Re-running worker
// acceptance". Credentials come from ADC; no secret or token is printed or saved.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { sourceFingerprint } from './check-cleanup-acceptance.mjs';

const ISSUER = 'https://login.luminull.com/';

export function idsHash(ids) {
  return createHash('sha256')
    .update(JSON.stringify([...ids].sort()))
    .digest('hex');
}

/** Only a state that passed every check may become an acceptance record. */
export function acceptanceRecord(state, env, fingerprint, checkedAt = new Date().toISOString()) {
  const missing = ['verified', 'replayed', 'scopeChecked'].filter((key) => state[key] !== true);
  if (missing.length) throw new Error(`Acceptance incomplete: ${missing.join(', ')}`);
  const prefix = `${env.GCP_REGION}-docker.pkg.dev/${env.GCP_PROJECT_ID}/wally/wally-api@sha256:`;
  if (!env.IMAGE?.startsWith(prefix) || !/^[a-f0-9]{64}$/.test(env.IMAGE.slice(prefix.length)))
    throw new Error('IMAGE must be the exact tested wally-api digest');
  const executions = {
    status: env.STATUS_EXECUTION,
    deletion: env.DELETION_EXECUTION,
    replay: env.REPLAY_EXECUTION,
  };
  if (Object.values(executions).some((id) => !/^wally-account-cleanup-[a-z0-9]+$/.test(id ?? '')))
    throw new Error('STATUS_EXECUTION, DELETION_EXECUTION and REPLAY_EXECUTION are required');
  if (!env.EVIDENCE_URL?.startsWith('https://github.com/milad-luminull/wally/'))
    throw new Error('EVIDENCE_URL must point into this repository');
  return {
    version: 1,
    checkedAt,
    sourceFingerprint: fingerprint,
    image: env.IMAGE,
    project: env.GCP_PROJECT_ID,
    database: 'wally',
    workerServiceAccount: `wally-account-cleanup@${env.GCP_PROJECT_ID}.iam.gserviceaccount.com`,
    secretVersion: env.AUTH0_CLEANUP_SECRET_VERSION,
    auth0ClientId: env.AUTH0_CLEANUP_CLIENT_ID,
    auth0ManagementDomain: env.AUTH0_MANAGEMENT_DOMAIN,
    evidenceUrl: env.EVIDENCE_URL,
    checks: {
      workerDatabaseAccess: true,
      workerSecretAccess: true,
      auth0DeleteUsersScope: true,
      firebaseFixtureDeletion: true,
      auth0FixtureDeletion: true,
      idempotentRetry: true,
    },
    executions,
  };
}

function admin(project) {
  // firebase-admin is an API dependency; resolve it from there, not the workspace root.
  const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
  const { initializeApp, applicationDefault } = require('firebase-admin/app');
  const app = initializeApp({ credential: applicationDefault(), projectId: project });
  return {
    auth: require('firebase-admin/auth').getAuth(app),
    db: require('firebase-admin/firestore').getFirestore(app, 'wally'),
    FieldValue: require('firebase-admin/firestore').FieldValue,
    Timestamp: require('firebase-admin/firestore').Timestamp,
  };
}

async function baselines(db) {
  const ids = async (name) => (await db.collection(name).select().get()).docs.map((d) => d.id);
  return {
    users: idsHash(await ids('users')),
    whiteboards: idsHash(await ids('whiteboards')),
    authIdentities: idsHash(await ids('authIdentities')),
  };
}

const sha = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');

async function create(env, statePath) {
  const email = env.FIXTURE_EMAIL;
  if (!/^[^@\s]+@[^@\s]+$/.test(email ?? '')) throw new Error('FIXTURE_EMAIL is required');
  const { auth, db, Timestamp } = admin(env.GCP_PROJECT_ID);
  const before = await baselines(db);
  const userId = randomUUID();
  const boardId = randomUUID();
  const noteId = randomUUID();
  const signup = await fetch(`${ISSUER}dbconnections/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.VITE_AUTH0_CLIENT_ID,
      connection: env.AUTH0_DB_CONNECTION || 'Username-Password-Authentication',
      email,
      // Never used to sign in and never stored; the identity only exists to be deleted.
      password: `${randomBytes(24).toString('base64url')}aA1!`,
    }),
    redirect: 'error',
  });
  const created = await signup.json().catch(() => ({}));
  if (!signup.ok || typeof created._id !== 'string')
    throw new Error(
      `Auth0 signup failed (${signup.status}): ${created.code ?? created.error ?? ''}`,
    );
  const subject = `auth0|${created._id}`;
  await auth.createUser({ uid: userId, email, disabled: true });
  const t = Timestamp.now();
  const batch = db.batch();
  batch.create(db.collection('users').doc(userId), {
    email: email.toLowerCase(),
    displayName: null,
    emailVerified: false,
    language: 'en',
    createdAt: t,
    updatedAt: t,
  });
  batch.create(db.collection('authIdentities').doc(sha(ISSUER, subject)), {
    issuer: ISSUER,
    subject,
    userId,
    createdAt: t,
  });
  batch.create(db.collection('whiteboards').doc(boardId), {
    name: 'Cleanup acceptance fixture',
    ownerId: userId,
    memberRoles: {},
    shareLinkToken: null,
    revision: 0,
    createdAt: t,
    updatedAt: t,
  });
  batch.create(db.collection('notes').doc(noteId), {
    whiteboardId: boardId,
    title: 'Cleanup acceptance fixture note',
    description: '',
    status: 'OPEN',
    completedAt: null,
    priority: 'NIEDRIG',
    horizon: 'SPAETER',
    freeX: 0,
    freeY: 0,
    dueDate: null,
    assigneeId: userId,
    tags: [],
    customFields: {},
    colour: 'WEISS',
    visibility: 'PRIVATE',
    createdById: userId,
    createdAt: t,
    updatedAt: t,
  });
  // The same documents requestAccountDeletion writes; the DELETE endpoint itself is not
  // under test here (it needs a recent sign-in).
  batch.create(db.collection('accountDeletionJobs').doc(userId), {
    userId,
    email: email.toLowerCase(),
    status: 'pending',
    createdAt: t,
    updatedAt: t,
    attempts: 0,
    identities: [{ issuer: ISSUER, subject }],
  });
  batch.set(db.collection('accountDenials').doc(sha('user', userId)), { createdAt: t });
  batch.set(db.collection('accountDenials').doc(sha('identity', ISSUER, subject)), {
    createdAt: t,
  });
  await batch.commit();
  const state = { userId, boardId, noteId, subject, before, queuedAt: t.toDate().toISOString() };
  writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  console.log(
    JSON.stringify({
      userId,
      queuedAt: state.queuedAt,
      runAfter: new Date(t.toMillis() + 150_000).toISOString(),
    }),
  );
}

async function verify(statePath, replay) {
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  const { auth, db } = admin(process.env.GCP_PROJECT_ID);
  const job = (await db.collection('accountDeletionJobs').doc(state.userId).get()).data();
  const firebaseGone = await auth.getUser(state.userId).then(
    () => false,
    (error) => error.code === 'auth/user-not-found',
  );
  const absent = async (name, id) => !(await db.collection(name).doc(id).get()).exists;
  const after = await baselines(db);
  const result = {
    status: job?.status,
    phase: job?.phase,
    attempts: job?.attempts,
    lastError: job?.lastError ?? null,
    firebaseUserNotFound: firebaseGone,
    userAbsent: await absent('users', state.userId),
    boardAbsent: await absent('whiteboards', state.boardId),
    noteAbsent: await absent('notes', state.noteId),
    identityMappingAbsent: await absent('authIdentities', sha(ISSUER, state.subject)),
    baselinesMatch: JSON.stringify(after) === JSON.stringify(state.before),
  };
  if (replay) result.attemptsUnchanged = job?.attempts === state.attempts;
  console.log(JSON.stringify(result, null, 2));
  const ok =
    result.status === 'complete' &&
    result.phase === 'complete' &&
    !job.lastError &&
    Object.entries(result).every(([key, value]) => typeof value !== 'boolean' || value);
  if (!ok) throw new Error('Fixture cleanup is not verified');
  Object.assign(state, replay ? { replayed: true } : { verified: true, attempts: job.attempts });
  writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
}

async function scope(env, statePath) {
  // The secret arrives on stdin and is used once; neither it nor the token is printed.
  const secret = readFileSync(0, 'utf8').trim();
  const origin = `https://${env.AUTH0_MANAGEMENT_DOMAIN}`;
  const response = await fetch(`${origin}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: env.AUTH0_CLEANUP_CLIENT_ID,
      client_secret: secret,
      audience: `${origin}/api/v2/`,
    }),
    redirect: 'error',
  });
  const data = await response.json().catch(() => ({}));
  console.log(JSON.stringify({ ok: response.ok, scope: data.scope ?? null }));
  if (!response.ok || data.scope !== 'delete:users')
    throw new Error('Cleanup client scope must be exactly delete:users');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  writeFileSync(statePath, JSON.stringify({ ...state, scopeChecked: true }, null, 2) + '\n', {
    mode: 0o600,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, statePath] = process.argv.slice(2);
  const env = process.env;
  try {
    if (!statePath)
      throw new Error(
        'Usage: cleanup-acceptance-fixture.mjs <create|verify|replay|scope|record> STATE_FILE',
      );
    if (env.GCP_PROJECT_ID !== 'luminull-wally' || env.FIRESTORE_EMULATOR_HOST)
      throw new Error('Runs only against production project luminull-wally, without an emulator');
    if (command === 'create') await create(env, statePath);
    else if (command === 'verify') await verify(statePath, false);
    else if (command === 'replay') await verify(statePath, true);
    else if (command === 'scope') await scope(env, statePath);
    else if (command === 'record') {
      const record = acceptanceRecord(
        JSON.parse(readFileSync(statePath, 'utf8')),
        env,
        sourceFingerprint(),
      );
      writeFileSync(
        'infra/account-cleanup-acceptance.json',
        JSON.stringify(record, null, 2) + '\n',
      );
      console.log('Wrote infra/account-cleanup-acceptance.json');
    } else throw new Error(`Unknown command ${command}`);
    process.exit(0);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
