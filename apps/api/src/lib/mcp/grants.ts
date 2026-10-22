import { randomUUID } from 'node:crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { liveWhiteboard, whiteboardsCol } from '../db/collections.js';
import { requireAccess, type Actor } from '../commands/context.js';
import { AppError } from '../errors.js';

export interface ConnectionGrant {
  id: string;
  clientId: string;
  name: string;
  scopes: ('wally:read' | 'wally:write')[];
  createdAt: string;
  issuedAfter: number;
  revokedAt: string | null;
}
const connections = (db: Firestore, userId: string) =>
  db.collection('users').doc(userId).collection('mcpConnections');
export async function listConnections(db: Firestore, userId: string): Promise<ConnectionGrant[]> {
  return (await connections(db, userId).get()).docs.map((doc) => doc.data() as ConnectionGrant);
}
export async function revokeConnection(db: Firestore, userId: string, id: string): Promise<void> {
  const ref = connections(db, userId).doc(id);
  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new AppError(404, 'NOT_FOUND', 'Not found');
    if (snapshot.data()!.revokedAt === null)
      tx.update(ref, { revokedAt: new Date().toISOString() });
  });
}
/** Auto-establishment is only permitted after the transport verifies identity and client. */
export async function requireConnection(
  db: Firestore,
  userId: string,
  token: { clientId: string; issuedAt: number; scopes: string[] },
  establish = false,
): Promise<ConnectionGrant> {
  if (!token.scopes.includes('wally:read')) throw consentRequired();
  const grant = await db.runTransaction(async (tx) => {
    const rows = (
      await tx.get(connections(db, userId).where('clientId', '==', token.clientId))
    ).docs.map((doc) => doc.data() as ConnectionGrant);
    const active = rows.find((row) => row.revokedAt === null);
    if (active) {
      if (token.issuedAt <= active.issuedAfter) throw consentRequired();
      return active;
    }
    // A refreshed access token is not proof that the user chose to reconnect.
    // Retain revoked records as tombstones; reconnect requires an explicit Wally action.
    if (!establish || rows.length) throw consentRequired();
    const created = accountConnection(token.clientId, token.issuedAt - 1);
    tx.create(connections(db, userId).doc(created.id), created);
    return created;
  });
  return { ...grant, scopes: grant.scopes.filter((scope) => token.scopes.includes(scope)) };
}
function consentRequired() {
  return new AppError(
    403,
    'MCP_CONSENT_REQUIRED',
    'This app is disconnected. Reconnect it in Wally Connected apps, then sign in again.',
  );
}
function accountConnection(clientId: string, issuedAfter: number): ConnectionGrant {
  return {
    id: randomUUID(),
    clientId,
    name: 'ChatGPT',
    scopes: ['wally:read', 'wally:write'],
    createdAt: new Date().toISOString(),
    issuedAfter,
    revokedAt: null,
  };
}
/** Explicit authenticated reconnect. Never invoked by an MCP token. */
export async function connectAccount(
  db: Firestore,
  userId: string,
  clientId: string,
): Promise<ConnectionGrant> {
  return db.runTransaction(async (tx) => {
    const rows = (await tx.get(connections(db, userId).where('clientId', '==', clientId))).docs.map(
      (doc) => doc.data() as ConnectionGrant,
    );
    const active = rows.find((row) => row.revokedAt === null);
    if (active) return active;
    const created = accountConnection(clientId, Math.floor(Date.now() / 1000));
    tx.create(connections(db, userId).doc(created.id), created);
    return created;
  });
}
/** Shared transaction guard: command receipts and writes see revocation/membership atomically. */
export async function authorizeConnectionBoardInTransaction(
  db: Firestore,
  tx: Transaction,
  actor: Actor,
  connectionId: string,
  boardId: string,
  write: boolean,
  enabled: boolean,
): Promise<void> {
  if (!enabled) throw new AppError(503, 'MCP_DISABLED', 'External AI access is disabled');
  const grant = (await tx.get(connections(db, actor.id).doc(connectionId))).data() as
    ConnectionGrant | undefined;
  if (!grant || grant.revokedAt || !grant.scopes.includes(write ? 'wally:write' : 'wally:read'))
    throw new AppError(403, 'MCP_CONSENT_REQUIRED', 'Connection does not permit this operation');
  const board = liveWhiteboard(await tx.get(whiteboardsCol(db).doc(boardId)));
  requireAccess(board, actor.id, write ? ['OWNER', 'EDIT'] : ['OWNER', 'EDIT', 'VIEW']);
}
export async function authorizeConnectionBoard(
  db: Firestore,
  actor: Actor,
  connectionId: string,
  boardId: string,
  write: boolean,
  enabled: boolean,
): Promise<void> {
  await db.runTransaction(
    (tx) =>
      authorizeConnectionBoardInTransaction(db, tx, actor, connectionId, boardId, write, enabled),
    { readOnly: true },
  );
}
