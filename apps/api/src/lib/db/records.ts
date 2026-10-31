import { eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import type { WhiteboardRole } from '@wally/shared';
import type { Database } from '../postgres/client.js';
import type { Transaction } from '../postgres/transaction.js';
import {
  boardMembers,
  notes,
  shareLinks,
  subtasks,
  users,
  whiteboards,
} from '../postgres/schema/index.js';

/** Anything a query can run on: the database itself or an open transaction. */
export type Queryable = Database | Transaction;

export type UserRow = typeof users.$inferSelect;
export type WhiteboardRow = typeof whiteboards.$inferSelect;
export type MemberRow = typeof boardMembers.$inferSelect;
export type ShareLinkRow = typeof shareLinks.$inferSelect;
export type NoteRow = typeof notes.$inferSelect;
export type SubtaskRow = typeof subtasks.$inferSelect;

/**
 * A board as every access check reads it: the row, the roles of its ACTIVE members by user
 * id, and its share link's token. Firestore kept both as caches on the board document; here
 * they are read with it, so there is nothing to keep in step.
 */
export type Board = WhiteboardRow & {
  memberRoles: Record<string, WhiteboardRole>;
  shareLinkToken: string | null;
};

/** A note with its subtask counts, which every NoteDto carries. */
export type Note = NoteRow & { subtaskSummary: { total: number; done: number } };

/*
 * The correlated subqueries below are plain SQL on purpose: in a single-table select Drizzle
 * leaves column names unqualified, and an unqualified `id` inside the subquery would name
 * the subquery's own table.
 */
const boardColumns = {
  ...getTableColumns(whiteboards),
  memberRoles: sql<Record<string, WhiteboardRole>>`coalesce((
    select jsonb_object_agg(m.user_id, m.role)
    from board_members m
    where m.board_id = whiteboards.id and m.status = 'ACTIVE' and m.user_id is not null
  ), '{}'::jsonb)`,
  shareLinkToken: sql<string | null>`(
    select l.token from share_links l where l.board_id = whiteboards.id
  )`,
};

/** The select shape of a Note: the row plus its subtask counts. Use it for note lists too. */
export const noteColumns = {
  ...getTableColumns(notes),
  subtaskSummary: sql<Note['subtaskSummary']>`(
    select jsonb_build_object(
      'total', count(*)::int,
      'done', (count(*) filter (where s.done))::int
    )
    from subtasks s where s.note_id = notes.id
  )`,
};

/** A board, tombstoned or not. Only the board.delete cleanup job may need the tombstone. */
export async function anyBoard(q: Queryable, id: string): Promise<Board | null> {
  const [board] = await q.select(boardColumns).from(whiteboards).where(eq(whiteboards.id, id));
  return board ?? null;
}

/**
 * A board that treats a tombstoned board as missing. Every board read in a query, command or
 * access check goes through this.
 */
export async function liveBoard(q: Queryable, id: string): Promise<Board | null> {
  const board = await anyBoard(q, id);
  return board && !board.deletedAt ? board : null;
}

/** A note, deleted or not; callers decide what a tombstone means for them. */
export async function loadNote(q: Queryable, id: string): Promise<Note | null> {
  const [note] = await q.select(noteColumns).from(notes).where(eq(notes.id, id));
  return note ?? null;
}

/**
 * Loads the users behind a set of ids in one query, skipping nulls and duplicates. NoteDto
 * embeds a UserSummary for assignee and creator, and MemberDto one per row; resolving them
 * one at a time would be a query per note.
 */
export async function loadUsers(
  q: Queryable,
  ids: (string | null | undefined)[],
): Promise<Map<string, UserRow>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const found = new Map<string, UserRow>();
  if (unique.length === 0) return found;
  for (const user of await q.select().from(users).where(inArray(users.id, unique)))
    found.set(user.id, user);
  return found;
}
