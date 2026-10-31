import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export type Database = PostgresJsDatabase<typeof schema>;

/**
 * A Drizzle database on its own postgres.js pool.
 *
 * Prepared statements are off everywhere, locally too: production will connect through
 * Supabase's transaction pooler, which does not support them, so local tests must fail
 * the same way production would (https://orm.drizzle.team/docs/connect-supabase).
 */
export function createDatabase(
  url: string,
  options: { max?: number } = {},
): { db: Database; sql: postgres.Sql; close: () => Promise<void> } {
  const sql = postgres(url, { prepare: false, max: options.max ?? 10, onnotice: () => {} });
  const db = drizzle(sql, { schema, casing: 'snake_case' });
  return { db, sql, close: () => sql.end() };
}
