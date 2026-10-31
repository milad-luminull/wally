import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { McpConnectionRow } from '../db/types.js';
import { liveBoard, type Queryable } from '../db/records.js';
import type { Database } from '../postgres/client.js';
import { withSnapshot, withTransaction, type Transaction } from '../postgres/transaction.js';
import { mcpConnections } from '../postgres/schema/index.js';
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

function toGrant(row: McpConnectionRow): ConnectionGrant {
  return {
    id: row.id,
    clientId: row.clientId,
    name: row.name,
    scopes: row.scopes,
    createdAt: row.createdAt.toISOString(),
    issuedAfter: row.issuedAfter,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

const forClient = (q: Queryable, userId: string, clientId: string) =>
  q
    .select()
    .from(mcpConnections)
    .where(and(eq(mcpConnections.userId, userId), eq(mcpConnections.clientId, clientId)));

export async function listConnections(db: Database, userId: string): Promise<ConnectionGrant[]> {
  const rows = await db.select().from(mcpConnections).where(eq(mcpConnections.userId, userId));
  return rows.map(toGrant);
}

export async function revokeConnection(db: Database, userId: string, id: string): Promise<void> {
  await withTransaction(db, async (tx) => {
    const [row] = await tx
      .select()
      .from(mcpConnections)
      .where(and(eq(mcpConnections.userId, userId), eq(mcpConnections.id, id)));
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Not found');
    if (row.revokedAt === null)
      await tx
        .update(mcpConnections)
        .set({ revokedAt: new Date() })
        .where(eq(mcpConnections.id, id));
  });
}

/** Auto-establishment is only permitted after the transport verifies identity and client. */
export async function requireConnection(
  db: Database,
  userId: string,
  token: { clientId: string; issuedAt: number; scopes: string[] },
  establish = false,
): Promise<ConnectionGrant> {
  if (!token.scopes.includes('wally:read')) throw consentRequired();
  const grant = await withTransaction(db, async (tx) => {
    const rows = await forClient(tx, userId, token.clientId);
    const active = rows.find((row) => row.revokedAt === null);
    if (active) {
      if (token.issuedAt <= active.issuedAfter) throw consentRequired();
      return toGrant(active);
    }
    // A refreshed access token is not proof that the user chose to reconnect.
    // Retain revoked records as tombstones; reconnect requires an explicit Wally action.
    if (!establish || rows.length) throw consentRequired();
    return createConnection(tx, userId, token.clientId, token.issuedAt - 1);
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

async function createConnection(
  tx: Transaction,
  userId: string,
  clientId: string,
  issuedAfter: number,
): Promise<ConnectionGrant> {
  const [row] = await tx
    .insert(mcpConnections)
    .values({
      id: randomUUID(),
      userId,
      clientId,
      name: 'ChatGPT',
      scopes: ['wally:read', 'wally:write'],
      createdAt: new Date(),
      issuedAfter,
    })
    .returning();
  return toGrant(row!);
}

/** Explicit authenticated reconnect. Never invoked by an MCP token. */
export async function connectAccount(
  db: Database,
  userId: string,
  clientId: string,
): Promise<ConnectionGrant> {
  return withTransaction(db, async (tx) => {
    const active = (await forClient(tx, userId, clientId)).find((row) => row.revokedAt === null);
    if (active) return toGrant(active);
    return createConnection(tx, userId, clientId, Math.floor(Date.now() / 1000));
  });
}

/** Shared transaction guard: command receipts and writes see revocation/membership atomically. */
export async function authorizeConnectionBoardInTransaction(
  tx: Transaction,
  actor: Actor,
  connectionId: string,
  boardId: string,
  write: boolean,
  enabled: boolean,
): Promise<void> {
  if (!enabled) throw new AppError(503, 'MCP_DISABLED', 'External AI access is disabled');
  const [grant] = await tx
    .select()
    .from(mcpConnections)
    .where(and(eq(mcpConnections.userId, actor.id), eq(mcpConnections.id, connectionId)));
  if (!grant || grant.revokedAt || !grant.scopes.includes(write ? 'wally:write' : 'wally:read'))
    throw new AppError(403, 'MCP_CONSENT_REQUIRED', 'Connection does not permit this operation');
  const board = await liveBoard(tx, boardId);
  requireAccess(board, actor.id, write ? ['OWNER', 'EDIT'] : ['OWNER', 'EDIT', 'VIEW']);
}

export async function authorizeConnectionBoard(
  db: Database,
  actor: Actor,
  connectionId: string,
  boardId: string,
  write: boolean,
  enabled: boolean,
): Promise<void> {
  await withSnapshot(db, (tx) =>
    authorizeConnectionBoardInTransaction(tx, actor, connectionId, boardId, write, enabled),
  );
}
