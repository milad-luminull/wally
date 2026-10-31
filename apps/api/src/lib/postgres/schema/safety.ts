import { index, integer, jsonb, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import { boardCommandSchema, effectiveRoleValues, type BoardCommand } from '@wally/shared';
import type { Provenance } from '../../assistant/provenance.js';
import type { CommandResult } from '../../commands/context.js';
import { users } from './accounts.js';
import { allOf, instant, oneOf } from './columns.js';

/**
 * A board command's receipt, per user and operation id, kept 7 days for replay. It names
 * its board without a foreign key: a retried command must still replay its stored result
 * after the board was deleted.
 */
export const boardOperations = pgTable(
  'board_operations',
  {
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    operationId: text().notNull(),
    fingerprint: text().notNull(),
    boardId: text().notNull(),
    /** The roles that authorized the command; replay re-checks the caller against them. */
    roles: text({ enum: effectiveRoleValues }).array().notNull(),
    result: jsonb().$type<CommandResult>().notNull(),
    provenance: jsonb().$type<Provenance>(),
    createdAt: instant().notNull(),
    expiresAt: instant().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.operationId] }),
    index().on(table.expiresAt),
    allOf('board_operations_roles_check', table.roles, effectiveRoleValues),
  ],
).enableRLS();

export const boardCleanupKindValues = ['note.delete', 'board.delete', 'member.remove'] as const;

/**
 * Work a committed command left for after its transaction. Durable: no foreign keys,
 * since the job outlives what it cleans up, and no expiry.
 */
export const boardCleanup = pgTable(
  'board_cleanup',
  {
    id: text().primaryKey(),
    kind: text({ enum: boardCleanupKindValues }).notNull(),
    boardId: text().notNull(),
    noteId: text(),
    userId: text(),
    createdAt: instant().notNull(),
  },
  (table) => [oneOf('board_cleanup_kind_check', table.kind, boardCleanupKindValues)],
).enableRLS();

const boardCommandTypes: readonly BoardCommand['type'][] = boardCommandSchema.options.map(
  (option) => option.shape.type.value,
);
const auditViaValues = ['mcp'] as const;

/** One contents-free record per command the assistant or MCP committed, kept 30 days. */
export const assistantAudit = pgTable(
  'assistant_audit',
  {
    operationId: text().primaryKey(),
    actorId: text().notNull(),
    boardId: text().notNull(),
    /** The note the command targeted or created; null for board commands. */
    targetId: text(),
    commandType: text().$type<BoardCommand['type']>().notNull(),
    conversationId: text(),
    approvalId: text(),
    via: text({ enum: auditViaValues }),
    connectionId: text(),
    revision: integer().notNull(),
    occurredAt: instant().notNull(),
    expiresAt: instant().notNull(),
  },
  (table) => [
    index().on(table.expiresAt),
    oneOf('assistant_audit_command_type_check', table.commandType, boardCommandTypes),
    oneOf('assistant_audit_via_check', table.via, auditViaValues),
  ],
).enableRLS();
