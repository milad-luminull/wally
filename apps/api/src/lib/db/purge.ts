import { lte } from 'drizzle-orm';
import type { Database } from '../postgres/client.js';
import {
  assistantAttempts,
  assistantAudit,
  assistantConversations,
  assistantSuggestions,
  assistantTidies,
  boardOperations,
} from '../postgres/schema/index.js';

const EXPIRING = {
  boardOperations,
  assistantAudit,
  assistantAttempts,
  assistantConversations,
  assistantSuggestions,
  assistantTidies,
};

export type PurgeCounts = Record<keyof typeof EXPIRING, number>;

/**
 * Deletes every row whose `expires_at` has passed, the job Firestore's TTL policies did.
 * Board cleanup jobs carry no expiry and are never touched: they must run to completion.
 *
 * Expiry is storage hygiene, not access control: like Firestore TTL, which deleted up to a
 * day late, a row may outlive its expiry until the next run.
 */
export async function purgeExpired(db: Database, now: Date = new Date()): Promise<PurgeCounts> {
  const counts = {} as PurgeCounts;
  for (const [name, table] of Object.entries(EXPIRING) as [
    keyof typeof EXPIRING,
    (typeof EXPIRING)[keyof typeof EXPIRING],
  ][]) {
    const result = await db.delete(table).where(lte(table.expiresAt, now));
    counts[name] = result.count;
  }
  return counts;
}
