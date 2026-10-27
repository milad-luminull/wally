import { boolean, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { languageValues } from '@wally/shared';
import type { StoredPreferences } from '../../db/types.js';

/** Instants are `timestamptz`, read and written as `Date`. */
export const instant = () => timestamp({ withTimezone: true, mode: 'date' });

export const users = pgTable(
  'users',
  {
    id: text().primaryKey(),
    /** Always stored lowercase. Not unique: identities, not emails, identify a person. */
    email: text().notNull(),
    displayName: text(),
    emailVerified: boolean().notNull(),
    language: text({ enum: languageValues }).notNull(),
    preferences: jsonb().$type<StoredPreferences>().notNull().default({}),
    createdAt: instant().notNull(),
    updatedAt: instant().notNull(),
  },
  (table) => [index().on(table.email)],
).enableRLS();
