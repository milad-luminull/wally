import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { AppError } from '../errors.js';

export interface McpWriteLimits {
  user: number;
  connection: number;
}
/** One rolling document per user, shared across instances. The connection map resets
 * each minute and can hold at most `limits.user` entries. No TTL setup is needed to
 * prevent per-window or per-reconnection document growth. Retries consume budget too. */
export async function consumeMcpWriteBudget(
  db: Firestore,
  actorId: string,
  connectionId: string,
  limits: McpWriteLimits = { user: 60, connection: 30 },
  at = Date.now(),
) {
  const window = Math.floor(at / 60_000);
  const connectionKey = createHash('sha256').update(connectionId).digest('hex');
  const ref = db.collection('users').doc(actorId).collection('mcpLimits').doc('writes');
  await db.runTransaction(async (tx) => {
    const row = (await tx.get(ref)).data();
    const current = row?.window === window;
    const count = current ? Number(row.count ?? 0) : 0;
    const connections: Record<string, number> = current ? (row.connections ?? {}) : {};
    const connectionCount = connections[connectionKey] ?? 0;
    if (count >= limits.user || connectionCount >= limits.connection)
      throw new AppError(429, 'RATE_LIMITED', 'Too many MCP writes');
    tx.set(ref, {
      window,
      count: count + 1,
      connections: { ...connections, [connectionKey]: connectionCount + 1 },
    });
  });
}
