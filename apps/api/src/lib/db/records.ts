import { eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import {
  DEFAULT_WALLYBOT_PREFERENCES,
  boardPreferencesSchema,
  canvasPatternSchema,
  paletteSchema,
  preferenceBoardIdSchema,
  themePreferenceSchema,
  wallybotPreferencesSchema,
  type Preferences,
  type WhiteboardRole,
} from '@wally/shared';
import type { Board, Note, UserRow } from './types.js';
import type { Database } from '../postgres/client.js';
import type { Transaction } from '../postgres/transaction.js';
import { notes, users, whiteboards } from '../postgres/schema/index.js';

/** Anything a query can run on: the database itself or an open transaction. */
export type Queryable = Database | Transaction;

/*
 * The correlated subqueries below are plain SQL on purpose: in a single-table select Drizzle
 * leaves column names unqualified, and an unqualified `id` inside the subquery would name
 * the subquery's own table.
 */
const boardColumns = {
  ...getTableColumns(whiteboards),
  // One role per member user: the strongest of their ACTIVE rows (strongestRole in
  // lib/members.ts), never the owner, who is OWNER through owner_id.
  memberRoles: sql<Record<string, WhiteboardRole>>`coalesce((
    select jsonb_object_agg(r.user_id, r.role) from (
      select m.user_id, case when bool_or(m.role = 'EDIT') then 'EDIT' else 'VIEW' end as role
      from board_members m
      where m.board_id = whiteboards.id
        and m.status = 'ACTIVE'
        and m.user_id is not null
        and m.user_id <> whiteboards.owner_id
      group by m.user_id
    ) r
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

/**
 * Emails are stored lowercase and compared exactly. Every write path runs addresses through
 * here so those comparisons hold.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * A profile's preferences, with every field defaulted and anything that no longer parses
 * dropped — a stored value written by an older schema must degrade to the default, never 500
 * GET /me.
 */
export function userPreferences(user: Pick<UserRow, 'preferences'>): Preferences {
  const stored = user.preferences;
  const theme = themePreferenceSchema.safeParse(stored.theme);
  const palette = paletteSchema.safeParse(stored.palette);
  const canvas = canvasPatternSchema.safeParse(stored.canvas);
  const lastBoardId = preferenceBoardIdSchema.safeParse(stored.lastBoardId);
  const wallybot = wallybotPreferencesSchema.safeParse(stored.wallybot);
  const boards: Preferences['boards'] = {};
  for (const [id, value] of Object.entries(stored.boards ?? {})) {
    const parsed = boardPreferencesSchema.safeParse(value);
    if (parsed.success && preferenceBoardIdSchema.safeParse(id).success) boards[id] = parsed.data;
  }
  return {
    theme: theme.success ? theme.data : 'system',
    palette: palette.success ? palette.data : 'paper',
    canvas: canvas.success ? canvas.data : 'dots',
    lastBoardId: lastBoardId.success ? lastBoardId.data : null,
    boards,
    wallybot: wallybot.success ? wallybot.data : DEFAULT_WALLYBOT_PREFERENCES,
  };
}

export const toIso = (value: Date): string => value.toISOString();

export const toIsoOrNull = (value: Date | null): string | null => (value ? toIso(value) : null);
