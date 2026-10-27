import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
} from 'drizzle-orm/pg-core';
import {
  noteColourValues,
  noteHistoryEventTypeValues,
  noteHorizonValues,
  notePriorityValues,
  noteStatusValues,
  noteVisibilityValues,
} from '@wally/shared';
import { whiteboards } from './boards.js';
import { instant, oneOf } from './columns.js';

/** Firestore cached each note's subtask counts; here they are a count over `subtasks`. */
export const notes = pgTable(
  'notes',
  {
    id: text().primaryKey(),
    boardId: text()
      .notNull()
      .references(() => whiteboards.id, { onDelete: 'cascade' }),
    revision: integer().notNull().default(1),
    deletedAt: instant(),
    title: text().notNull(),
    description: text().notNull().default(''),
    status: text({ enum: noteStatusValues }).notNull(),
    completedAt: instant(),
    priority: text({ enum: notePriorityValues }).notNull(),
    horizon: text({ enum: noteHorizonValues }).notNull(),
    freeX: doublePrecision().notNull(),
    freeY: doublePrecision().notNull(),
    /** A calendar day with no timezone, read and written as 'YYYY-MM-DD'. */
    dueDate: date({ mode: 'string' }),
    assigneeId: text(),
    tags: text().array().notNull().default([]),
    /** Related notes, by id. */
    links: text().array().notNull().default([]),
    customFields: jsonb().$type<Record<string, string>>().notNull().default({}),
    colour: text({ enum: noteColourValues }).notNull(),
    visibility: text({ enum: noteVisibilityValues }).notNull().default('SHARED'),
    createdById: text(),
    createdAt: instant().notNull(),
    updatedAt: instant().notNull(),
  },
  (table) => [
    index().on(table.boardId),
    index().on(table.boardId, table.assigneeId),
    oneOf('notes_status_check', table.status, noteStatusValues),
    oneOf('notes_priority_check', table.priority, notePriorityValues),
    oneOf('notes_horizon_check', table.horizon, noteHorizonValues),
    oneOf('notes_colour_check', table.colour, noteColourValues),
    oneOf('notes_visibility_check', table.visibility, noteVisibilityValues),
    // A private note belongs to its author alone (RFC-0001).
    check(
      'notes_private_is_authors_check',
      sql`${table.visibility} <> 'PRIVATE' or (${table.createdById} is not null and ${table.assigneeId} = ${table.createdById})`,
    ),
  ],
).enableRLS();

export const subtasks = pgTable(
  'subtasks',
  {
    id: text().primaryKey(),
    noteId: text()
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    text: text().notNull(),
    done: boolean().notNull(),
    sortIndex: integer().notNull(),
    createdAt: instant().notNull(),
    updatedAt: instant().notNull(),
  },
  (table) => [index().on(table.noteId, table.sortIndex)],
).enableRLS();

export const noteHistory = pgTable(
  'note_history',
  {
    id: text().primaryKey(),
    noteId: text()
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    type: text({ enum: noteHistoryEventTypeValues }).notNull(),
    occurredAt: instant().notNull(),
    actorId: text(),
    metadata: jsonb().$type<Record<string, unknown>>(),
  },
  (table) => [
    index().on(table.noteId, table.occurredAt),
    oneOf('note_history_type_check', table.type, noteHistoryEventTypeValues),
  ],
).enableRLS();
