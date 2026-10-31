import { sql } from 'drizzle-orm';
import type { Database } from '../postgres/client.js';

const TABLES = {
  board_operations: 'boardOperations',
  assistant_audit: 'assistantAudit',
  assistant_attempts: 'assistantAttempts',
  assistant_conversations: 'assistantConversations',
  assistant_suggestions: 'assistantSuggestions',
  assistant_tidies: 'assistantTidies',
} as const;

export type PurgeCounts = Record<(typeof TABLES)[keyof typeof TABLES], number>;

/**
 * Deletes every row whose `expires_at` has passed, through the `purge_expired()` database
 * function (apps/api/drizzle/0001_purge_expired.sql). A Supabase Cron job runs the same
 * function hourly; this is for `pnpm maintenance`. Board cleanup jobs carry no expiry and
 * are never touched.
 *
 * Expiry is storage hygiene, not access control: a row may outlive its expiry until the
 * next run.
 */
export async function purgeExpired(db: Database, now: Date = new Date()): Promise<PurgeCounts> {
  const rows = await db.execute<{ table_name: keyof typeof TABLES; deleted: string }>(
    sql`select * from purge_expired(${now.toISOString()}::timestamptz)`,
  );
  const counts = {} as PurgeCounts;
  for (const row of rows) counts[TABLES[row.table_name]] = Number(row.deleted);
  return counts;
}
