import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { foldFieldKey, noteListQuerySchema, type Language } from '@wally/shared';
import { liveBoard, loadNote, loadUsers, noteColumns } from '../db/records.js';
import type { Note } from '../db/types.js';
import type { Database } from '../postgres/client.js';
import { withSnapshot, type Transaction } from '../postgres/transaction.js';
import {
  boardMembers,
  noteHistory,
  notes as notesTable,
  shareLinks,
  subtasks,
  whiteboards,
} from '../postgres/schema/index.js';
import {
  ownerMemberDto,
  toMemberDto,
  toNoteDetailDto,
  toNoteDto,
  toShareLinkDto,
  toWhiteboardDto,
} from '../dto.js';
import { visibleLinks } from '../visibleLinks.js';
import { canSeeNote } from '../notes.js';
import { requireAccess, notFound, type Actor } from './context.js';

/**
 * The `?field=` filter: "Customer" (the note has the property) or "Customer:Müller GmbH" (and it
 * equals that value). Split on the first colon only, so a value may itself contain one. Key and
 * value compare case-insensitively through the shared, locale-neutral fold (`foldFieldKey`), so
 * "customer" finds "Customer" for every caller and "STRASSE" never finds "Straße".
 */
export function matchesFieldFilter(customFields: Record<string, string>, field: string): boolean {
  const separator = field.indexOf(':');
  const rawKey = separator === -1 ? field : field.slice(0, separator);
  const rawValue = separator === -1 ? undefined : field.slice(separator + 1);
  const wantedKey = foldFieldKey(rawKey);
  const wantedValue = rawValue?.trim().toLowerCase();
  return Object.entries(customFields).some(
    ([key, value]) =>
      foldFieldKey(key) === wantedKey &&
      (wantedValue === undefined || value.toLowerCase() === wantedValue),
  );
}

/**
 * Due date (undated last), then creation, then id. The id makes the order total: PostgreSQL
 * returns rows in no fixed order, and an edit can move a row, so notes created in the same
 * millisecond (every seeded note) must not trade places after one is edited.
 */
export function byDueDateThenCreated(
  a: Pick<Note, 'id' | 'dueDate' | 'createdAt'>,
  b: Pick<Note, 'id' | 'dueDate' | 'createdAt'>,
): number {
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  return a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export async function getBoard(db: Database, actor: Actor, boardId: string) {
  const board = await liveBoard(db, boardId);
  const role = requireAccess(board, actor.id, ['OWNER', 'EDIT', 'VIEW']);
  return toWhiteboardDto(board!, role);
}
export async function listBoards(db: Database, actor: Actor) {
  return withSnapshot(db, async (tx) => {
    // Owned boards first, then the ones the caller is an ACTIVE member of.
    const rows = await tx
      .select({ id: whiteboards.id, ownerId: whiteboards.ownerId })
      .from(whiteboards)
      .leftJoin(
        boardMembers,
        and(
          eq(boardMembers.boardId, whiteboards.id),
          eq(boardMembers.userId, actor.id),
          eq(boardMembers.status, 'ACTIVE'),
        ),
      )
      .where(
        and(
          isNull(whiteboards.deletedAt),
          or(eq(whiteboards.ownerId, actor.id), eq(boardMembers.userId, actor.id)),
        ),
      )
      .orderBy(asc(whiteboards.createdAt), asc(whiteboards.id));
    const ids = [
      ...new Set([
        ...rows.filter((row) => row.ownerId === actor.id).map((row) => row.id),
        ...rows.map((row) => row.id),
      ]),
    ];
    const results = [];
    for (const id of ids) {
      const board = await liveBoard(tx, id);
      if (!board) continue;
      const role = board.ownerId === actor.id ? ('OWNER' as const) : board.memberRoles[actor.id];
      if (role) results.push({ id, name: board.name, currentUserRole: role });
    }
    return results;
  });
}
async function boardSnapshot(tx: Transaction, actor: Actor, boardId: string, ownerOnly = false) {
  const board = await liveBoard(tx, boardId);
  requireAccess(board, actor.id, ownerOnly ? ['OWNER'] : ['OWNER', 'EDIT', 'VIEW']);
  return board!;
}
export async function listNotes(db: Database, actor: Actor, boardId: string, rawQuery: unknown) {
  const query = noteListQuerySchema.parse(rawQuery);
  return withSnapshot(db, async (tx) => {
    await boardSnapshot(tx, actor, boardId);
    let notes = (
      await tx
        .select(noteColumns)
        .from(notesTable)
        .where(and(eq(notesTable.boardId, boardId), isNull(notesTable.deletedAt)))
    ).filter((n) => canSeeNote(n, actor.id));
    const visibleIds = new Set(notes.map((n) => n.id));
    if (query.status !== 'ALL') notes = notes.filter((n) => n.status === query.status);
    if (query.priority?.length) {
      notes = notes.filter((n) => query.priority!.includes(n.priority));
    }
    if (query.horizon?.length) {
      notes = notes.filter((n) => query.horizon!.includes(n.horizon));
    }
    if (query.assignedToMe) notes = notes.filter((n) => n.assigneeId === actor.id);
    if (query.visibility) notes = notes.filter((n) => n.visibility === query.visibility);

    if (query.q) {
      const needle = query.q.toLowerCase();
      notes = notes.filter(
        (n) =>
          n.title.toLowerCase().includes(needle) ||
          n.description.toLowerCase().includes(needle) ||
          n.tags.some((t) => t.toLowerCase().includes(needle)) ||
          Object.entries(n.customFields).some(
            ([key, value]) =>
              key.toLowerCase().includes(needle) || value.toLowerCase().includes(needle),
          ),
      );
    }

    if (query.field) {
      const field = query.field;
      notes = notes.filter((n) => matchesFieldFilter(n.customFields, field));
    }

    notes.sort(byDueDateThenCreated);

    const users = await loadUsers(
      tx,
      notes.flatMap((n) => [n.assigneeId, n.createdById]),
    );
    return notes.map((n) =>
      toNoteDto({ ...n, links: n.links.filter((id) => visibleIds.has(id)) }, users),
    );
  });
}
export async function getNote(
  db: Database,
  actor: Actor,
  noteId: string,
  expectedBoardId?: string,
) {
  return withSnapshot(db, async (tx) => {
    const note = await loadNote(tx, noteId);
    if (
      !note ||
      note.deletedAt ||
      !canSeeNote(note, actor.id) ||
      (expectedBoardId && note.boardId !== expectedBoardId)
    )
      notFound();
    await boardSnapshot(tx, actor, note.boardId);
    const tasks = await tx.select().from(subtasks).where(eq(subtasks.noteId, noteId));
    const history = await tx.select().from(noteHistory).where(eq(noteHistory.noteId, noteId));
    return toNoteDetailDto(
      { ...note, links: await visibleLinks(tx, note, actor.id) },
      tasks,
      history,
      await loadUsers(tx, [note.assigneeId, note.createdById, ...history.map((h) => h.actorId)]),
    );
  });
}
export async function listMembers(db: Database, actor: Actor, boardId: string) {
  return withSnapshot(db, async (tx) => {
    const board = await boardSnapshot(tx, actor, boardId);
    const members = (
      await tx
        .select()
        .from(boardMembers)
        .where(eq(boardMembers.boardId, boardId))
        .orderBy(asc(boardMembers.invitedAt), asc(boardMembers.id))
    ).filter((m) => m.userId !== board.ownerId);
    const users = await loadUsers(tx, [board.ownerId, ...members.map((m) => m.userId)]);
    return {
      data: [ownerMemberDto(board, users), ...members.map((m) => toMemberDto(m, users))],
      revision: board.revision,
    };
  });
}
export async function getShareLink(db: Database, actor: Actor, boardId: string, baseUrl: string) {
  return withSnapshot(db, async (tx) => {
    const board = await boardSnapshot(tx, actor, boardId, true);
    const [link] = await tx.select().from(shareLinks).where(eq(shareLinks.boardId, board.id));
    if (!link) notFound();
    return { data: toShareLinkDto(link, baseUrl), revision: board.revision };
  });
}
/** The board's tags in use, each once, sorted for the caller's language (their profile's). */
export async function listTags(db: Database, actor: Actor, boardId: string, language: Language) {
  const notes = await listNotes(db, actor, boardId, {});
  return [...new Set(notes.flatMap((n) => n.tags))].sort((a, b) => a.localeCompare(b, language));
}
