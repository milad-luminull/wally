import { boolean, index, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { membershipStatusValues, whiteboardRoleValues } from '@wally/shared';
import { users } from './accounts.js';
import { instant, oneOf } from './columns.js';

/**
 * Firestore cached each board's member roles and share-link token on the board itself.
 * Here both are a join (`board_members`, `share_links.board_id`), so there is no cache to
 * keep in step.
 */
export const whiteboards = pgTable(
  'whiteboards',
  {
    id: text().primaryKey(),
    ownerId: text()
      .notNull()
      .references(() => users.id),
    name: text().notNull(),
    revision: integer().notNull().default(1),
    /** Set by board.delete; the board then reads as absent until cleanup removes it. */
    deletedAt: instant(),
    assistantDisabled: boolean().notNull().default(false),
    createdAt: instant().notNull(),
    updatedAt: instant().notNull(),
  },
  (table) => [index().on(table.ownerId)],
).enableRLS();

export const boardMembers = pgTable(
  'board_members',
  {
    id: text().primaryKey(),
    boardId: text()
      .notNull()
      .references(() => whiteboards.id, { onDelete: 'cascade' }),
    userId: text(),
    /** Always stored lowercase. */
    invitedEmail: text(),
    role: text({ enum: whiteboardRoleValues }).notNull(),
    status: text({ enum: membershipStatusValues }).notNull(),
    invitedAt: instant().notNull(),
    activatedAt: instant(),
  },
  (table) => [
    index().on(table.boardId, table.userId),
    // "Which boards am I an active member of" (listBoards).
    index().on(table.userId, table.status),
    index().on(table.invitedEmail),
    oneOf('board_members_role_check', table.role, whiteboardRoleValues),
    oneOf('board_members_status_check', table.status, membershipStatusValues),
  ],
).enableRLS();

/** A board's one share link, keyed by its token. */
export const shareLinks = pgTable(
  'share_links',
  {
    token: text().primaryKey(),
    boardId: text()
      .notNull()
      .unique()
      .references(() => whiteboards.id, { onDelete: 'cascade' }),
    role: text({ enum: whiteboardRoleValues }).notNull(),
    createdAt: instant().notNull(),
    updatedAt: instant().notNull(),
  },
  (table) => [oneOf('share_links_role_check', table.role, whiteboardRoleValues)],
).enableRLS();
