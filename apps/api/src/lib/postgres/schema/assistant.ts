import {
  bigint,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
} from 'drizzle-orm/pg-core';
import { tidyStatusSchema } from '@wally/shared';
import type {
  AssistantConversationDoc,
  AssistantSuggestionDoc,
  AssistantTidyDoc,
} from '../../db/types.js';
import { users } from './accounts.js';
import { instant, oneOf } from './columns.js';
import type { AsJson } from './json.js';

/**
 * The assistant's records are the user's own: each belongs to a user and cascades with
 * them. They name boards and notes without foreign keys and expire on their own.
 */

/** A user's assistant tokens for one UTC day, and the model calls in flight. */
export const assistantUsage = pgTable(
  'assistant_usage',
  {
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    day: date({ mode: 'string' }).notNull(),
    /** Reserved worst case, replaced by the actual usage on settlement. */
    tokens: integer().notNull(),
    /** attemptId -> startedAt millis. */
    inFlight: jsonb().$type<Record<string, number>>().notNull().default({}),
    updatedAt: instant().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.day] })],
).enableRLS();

/** The deployment key's spend for one UTC month ('YYYY-MM'). */
export const assistantSpend = pgTable('assistant_spend', {
  month: text().primaryKey(),
  microUsd: bigint({ mode: 'number' }).notNull(),
  updatedAt: instant().notNull(),
}).enableRLS();

export const attemptStateValues = ['RESERVED', 'SETTLED', 'ABANDONED'] as const;

/** One reserved model call, then settled with its usage or abandoned without it. */
export const assistantAttempts = pgTable(
  'assistant_attempts',
  {
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    day: date({ mode: 'string' }).notNull(),
    month: text().notNull(),
    reservedTokens: integer().notNull(),
    reservedMicroUsd: bigint({ mode: 'number' }).notNull(),
    /** The price at reservation, used again at settlement. */
    inputMicroUsdPerToken: doublePrecision().notNull(),
    outputMicroUsdPerToken: doublePrecision().notNull(),
    state: text({ enum: attemptStateValues }).notNull(),
    settledTokens: integer(),
    settledMicroUsd: bigint({ mode: 'number' }),
    createdAt: instant().notNull(),
    settledAt: instant(),
    abandonedAt: instant(),
    expiresAt: instant().notNull(),
  },
  (table) => [
    index().on(table.userId),
    index().on(table.expiresAt),
    oneOf('assistant_attempts_state_check', table.state, attemptStateValues),
  ],
).enableRLS();

export const conversationStatusValues = ['OPEN', 'CLOSED'] as const;

/** One read-only assistant conversation on a board. */
export const assistantConversations = pgTable(
  'assistant_conversations',
  {
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    boardId: text().notNull(),
    /** The provider:model the conversation is pinned to. */
    model: text().notNull(),
    status: text({ enum: conversationStatusValues }).notNull(),
    turns: integer().notNull(),
    /** The model library's own messages, opaque JSON, replayed on continuation. */
    messages: jsonb().$type<unknown[]>().notNull(),
    entries: jsonb().$type<AsJson<AssistantConversationDoc['entries']>>().notNull(),
    usage: jsonb().$type<AssistantConversationDoc['usage']>().notNull(),
    toolCalls: integer().notNull(),
    createdAt: instant().notNull(),
    lastTurnAt: instant().notNull(),
    expiresAt: instant().notNull(),
  },
  (table) => [
    index().on(table.userId, table.boardId),
    index().on(table.expiresAt),
    oneOf('assistant_conversations_status_check', table.status, conversationStatusValues),
  ],
).enableRLS();

export const suggestionStatusValues = ['PENDING', 'KEPT', 'UNDONE', 'DISCARDED'] as const;

type Suggestion = AsJson<AssistantSuggestionDoc>;

/** The approval record for one capture (RFC-0003 §3.2, RFC-0005 §4). */
export const assistantSuggestions = pgTable(
  'assistant_suggestions',
  {
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    boardId: text().notNull(),
    noteId: text().notNull(),
    baseRevision: integer().notNull(),
    baseTitle: text(),
    fields: jsonb().$type<Suggestion['fields']>().notNull(),
    typed: text().$type<NonNullable<Suggestion['typed']>[number]>().array(),
    operationIds: jsonb().$type<Suggestion['operationIds']>().notNull(),
    status: text({ enum: suggestionStatusValues }).notNull(),
    decision: jsonb().$type<NonNullable<Suggestion['decision']>>(),
    undone: jsonb().$type<NonNullable<Suggestion['undone']>>(),
    applied: jsonb().$type<NonNullable<Suggestion['applied']>>(),
    model: text().notNull(),
    usage: jsonb().$type<Suggestion['usage']>().notNull(),
    createdAt: instant().notNull(),
    updatedAt: instant().notNull(),
    expiresAt: instant().notNull(),
  },
  (table) => [
    index().on(table.userId, table.noteId),
    index().on(table.expiresAt),
    oneOf('assistant_suggestions_status_check', table.status, suggestionStatusValues),
  ],
).enableRLS();

const tidyStatusValues = tidyStatusSchema.options;

type Tidy = AsJson<AssistantTidyDoc>;

/** The approval record for one Tidy of the horizon wall (RFC-0005 §3.5). */
export const assistantTidies = pgTable(
  'assistant_tidies',
  {
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    boardId: text().notNull(),
    status: text({ enum: tidyStatusValues }).notNull(),
    moves: jsonb().$type<Tidy['moves']>().notNull(),
    decision: jsonb().$type<NonNullable<Tidy['decision']>>(),
    undone: jsonb().$type<NonNullable<Tidy['undone']>>(),
    applied: jsonb().$type<NonNullable<Tidy['applied']>>(),
    /** Null when every move came from the date rule and no model ran. */
    model: text(),
    usage: jsonb().$type<NonNullable<Tidy['usage']>>(),
    createdAt: instant().notNull(),
    updatedAt: instant().notNull(),
    expiresAt: instant().notNull(),
  },
  (table) => [
    index().on(table.userId, table.boardId),
    index().on(table.expiresAt),
    oneOf('assistant_tidies_status_check', table.status, tidyStatusValues),
  ],
).enableRLS();
