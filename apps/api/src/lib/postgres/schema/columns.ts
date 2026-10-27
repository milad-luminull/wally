import { sql, type SQL } from 'drizzle-orm';
import { check, timestamp, type AnyPgColumn } from 'drizzle-orm/pg-core';

/** Instants are `timestamptz`, read and written as `Date`. */
export const instant = () => timestamp({ withTimezone: true, mode: 'date' });

/**
 * A check constraint that holds `column` to the given values. Enum columns stay `text`
 * (renaming a value is then one migration, not an enum-type dance), and the check keeps
 * them to the values `@wally/shared` declares.
 */
export function oneOf(name: string, column: AnyPgColumn, values: readonly string[]) {
  const list = values.map((value) => `'${value.replaceAll("'", "''")}'`).join(', ');
  const condition: SQL = sql`${column} in (${sql.raw(list)})`;
  return check(name, condition);
}
