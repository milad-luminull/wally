import { randomUUID } from 'node:crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { mcpGrantInputSchema } from '@wally/shared';
import { liveWhiteboard, whiteboardsCol } from '../db/collections.js';
import { requireAccess, type Actor } from '../commands/context.js';
import { AppError } from '../errors.js';

export const grantInputSchema = mcpGrantInputSchema;
export interface ConnectionGrant {
  id: string;
  clientId: string;
  name: string;
  boardIds: string[];
  scopes: ('wally:read' | 'wally:write')[];
  createdAt: string;
  issuedAfter: number;
  revokedAt: string | null;
}
const connections = (db: Firestore, userId: string) =>
  db.collection('users').doc(userId).collection('mcpConnections');
const policy = (db: Firestore, boardId: string) => db.collection('mcpBoardPolicies').doc(boardId);
async function checkBoard(
  db: Firestore,
  tx: Transaction,
  actor: Actor,
  boardId: string,
  write: boolean,
) {
  const [boardSnapshot, setting] = await Promise.all([
    tx.get(whiteboardsCol(db).doc(boardId)),
    tx.get(policy(db, boardId)),
  ]);
  const board = liveWhiteboard(boardSnapshot);
  requireAccess(board, actor.id, write ? ['OWNER', 'EDIT'] : ['OWNER', 'EDIT', 'VIEW']);
  if (
    board!.assistantDisabled ||
    setting.data()?.enabled !== true ||
    setting.data()?.ownerId !== board!.ownerId
  ) {
    throw new AppError(403, 'MCP_BOARD_DISABLED', 'The board owner must enable external AI access');
  }
}
export async function setBoardPolicy(
  db: Firestore,
  actor: Actor,
  boardId: string,
  enabled: boolean,
) {
  await db.runTransaction(async (tx) => {
    const board = liveWhiteboard(await tx.get(whiteboardsCol(db).doc(boardId)));
    requireAccess(board, actor.id, ['OWNER']);
    tx.set(policy(db, boardId), {
      enabled,
      ownerId: actor.id,
      updatedAt: new Date().toISOString(),
    });
  });
  return { enabled };
}
export async function getBoardPolicy(db: Firestore, actor: Actor, boardId: string) {
  return db.runTransaction(
    async (tx) => {
      const board = liveWhiteboard(await tx.get(whiteboardsCol(db).doc(boardId)));
      requireAccess(board, actor.id, ['OWNER', 'EDIT', 'VIEW']);
      const setting = (await tx.get(policy(db, boardId))).data();
      return { enabled: setting?.enabled === true && setting.ownerId === board!.ownerId };
    },
    { readOnly: true },
  );
}
export async function createConnection(
  db: Firestore,
  actor: Actor,
  clientId: string,
  boardIds: string[],
  write: boolean,
): Promise<ConnectionGrant> {
  const input = grantInputSchema.parse({ clientId, boardIds, write });
  const grant: ConnectionGrant = {
    id: randomUUID(),
    clientId,
    name: 'ChatGPT',
    boardIds: [...new Set(input.boardIds)],
    scopes: write ? ['wally:read', 'wally:write'] : ['wally:read'],
    createdAt: new Date().toISOString(),
    issuedAfter: Math.floor(Date.now() / 1000),
    revokedAt: null,
  };
  await db.runTransaction(async (tx) => {
    const existing = await tx.get(connections(db, actor.id).where('clientId', '==', clientId));
    if (existing.docs.some((doc) => doc.data().revokedAt === null))
      throw new AppError(
        409,
        'CONNECTION_EXISTS',
        'Revoke the existing connection before changing its access',
      );
    for (const boardId of grant.boardIds) await checkBoard(db, tx, actor, boardId, write);
    tx.create(connections(db, actor.id).doc(grant.id), grant);
  });
  return grant;
}
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
export async function requireConnection(
  db: Firestore,
  userId: string,
  token: { clientId: string; issuedAt: number; scopes: string[] },
): Promise<ConnectionGrant> {
  const grants = (
    await connections(db, userId).where('clientId', '==', token.clientId).get()
  ).docs.map((doc) => doc.data() as ConnectionGrant);
  const grant = grants.find((row) => row.revokedAt === null && token.issuedAt > row.issuedAfter);
  if (!grant || !token.scopes.includes('wally:read'))
    throw new AppError(
      403,
      'MCP_CONSENT_REQUIRED',
      'Approve board access in Wally, then reconnect your AI client',
    );
  return { ...grant, scopes: grant.scopes.filter((scope) => token.scopes.includes(scope)) };
}
/** Shared transaction guard: command receipts and writes see revocation/policy atomically. */
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
  if (
    !grant ||
    grant.revokedAt ||
    !grant.boardIds.includes(boardId) ||
    !grant.scopes.includes(write ? 'wally:write' : 'wally:read')
  )
    throw new AppError(403, 'MCP_CONSENT_REQUIRED', 'Connection does not permit this operation');
  await checkBoard(db, tx, actor, boardId, write);
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
