import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { languageValues } from '@wally/shared';
import type { StoredPreferences } from '../../db/types.js';
import { allOf, instant, oneOf } from './columns.js';

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
  (table) => [
    index().on(table.email),
    oneOf('users_language_check', table.language, languageValues),
  ],
).enableRLS();

/** An external identity, by issuer and subject, mapped to one Wally user. */
export const authIdentities = pgTable(
  'auth_identities',
  {
    issuer: text().notNull(),
    subject: text().notNull(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: instant().notNull(),
  },
  (table) => [primaryKey({ columns: [table.issuer, table.subject] }), index().on(table.userId)],
).enableRLS();

export const mcpScopeValues = ['wally:read', 'wally:write'] as const;

/** One MCP client connection of a user; revoked connections stay as tombstones. */
export const mcpConnections = pgTable(
  'mcp_connections',
  {
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    clientId: text().notNull(),
    name: text().notNull(),
    scopes: text({ enum: mcpScopeValues }).array().notNull(),
    createdAt: instant().notNull(),
    /** Tokens issued before this epoch second are rejected (the issuance cutoff). */
    issuedAfter: bigint({ mode: 'number' }).notNull(),
    revokedAt: instant(),
  },
  (table) => [
    allOf('mcp_connections_scopes_check', table.scopes, mcpScopeValues),
    check('mcp_connections_scopes_not_empty_check', sql`cardinality(${table.scopes}) > 0`),
    index().on(table.userId, table.clientId),
    uniqueIndex('mcp_connections_one_active_per_client')
      .on(table.userId, table.clientId)
      .where(sql`${table.revokedAt} is null`),
  ],
).enableRLS();

export const mcpLimitKindValues = ['writes', 'requests'] as const;

/** A user's MCP request or write count in the current one-minute window. */
export const mcpLimits = pgTable(
  'mcp_limits',
  {
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text({ enum: mcpLimitKindValues }).notNull(),
    /** Minutes since the epoch. */
    window: bigint({ mode: 'number' }).notNull(),
    count: integer().notNull(),
    /** Count per connection in this window, keyed by a hash of the connection id. */
    connections: jsonb().$type<Record<string, number>>().notNull().default({}),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.kind] }),
    oneOf('mcp_limits_kind_check', table.kind, mcpLimitKindValues),
  ],
).enableRLS();
