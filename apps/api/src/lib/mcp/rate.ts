import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { AppError } from '../errors.js';
import type { Database } from '../postgres/client.js';
import { withTransaction } from '../postgres/transaction.js';
import { mcpLimits } from '../postgres/schema/index.js';

export interface McpWriteLimits {
  user: number;
  connection: number;
}
/** One rolling row per user and kind, shared across instances. The connection map resets
 * each minute and can hold at most `limits.user` entries, so rows never grow per window or
 * per reconnection. Retries consume budget too. */
export async function consumeMcpWriteBudget(
  db: Database,
  actorId: string,
  connectionId: string,
  limits: McpWriteLimits = { user: 60, connection: 30 },
  at = Date.now(),
) {
  return consumeBudget(db, actorId, connectionId, 'writes', limits, at);
}

/** Includes discovery, reads, widgets and writes; shared across server instances. */
export async function consumeMcpRequestBudget(
  db: Database,
  actorId: string,
  connectionId: string,
  limits: McpWriteLimits = { user: 300, connection: 300 },
  at = Date.now(),
) {
  return consumeBudget(db, actorId, connectionId, 'requests', limits, at);
}

async function consumeBudget(
  db: Database,
  actorId: string,
  connectionId: string,
  kind: 'writes' | 'requests',
  limits: McpWriteLimits,
  at: number,
) {
  const window = Math.floor(at / 60_000);
  const connectionKey = createHash('sha256').update(connectionId).digest('hex');
  await withTransaction(db, async (tx) => {
    const [row] = await tx
      .select()
      .from(mcpLimits)
      .where(and(eq(mcpLimits.userId, actorId), eq(mcpLimits.kind, kind)));
    const current = row?.window === window;
    const count = current ? row.count : 0;
    const connections: Record<string, number> = current ? row.connections : {};
    const connectionCount = connections[connectionKey] ?? 0;
    if (count >= limits.user || connectionCount >= limits.connection)
      throw new AppError(429, 'RATE_LIMITED', `Too many MCP ${kind}`);
    const next = {
      window,
      count: count + 1,
      connections: { ...connections, [connectionKey]: connectionCount + 1 },
    };
    await tx
      .insert(mcpLimits)
      .values({ userId: actorId, kind, ...next })
      .onConflictDoUpdate({ target: [mcpLimits.userId, mcpLimits.kind], set: next });
  });
}
