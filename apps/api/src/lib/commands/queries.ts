import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { DEFAULT_LANGUAGE, normalizeFieldKey, noteListQuerySchema } from '@wally/shared';
import {
  docsWithId,
  historyCol,
  liveWhiteboard,
  loadUsers,
  membersCol,
  membersGroup,
  notesCol,
  shareLinksCol,
  subtasksCol,
  whiteboardsCol,
  withId,
} from '../db/collections.js';
import type { NoteDoc, WithId } from '../db/types.js';
import {
  ownerMemberDto,
  toMemberDto,
  toNoteDetailDto,
  toNoteDto,
  toShareLinkDto,
  toWhiteboardDto,
} from '../dto.js';
import { requireAccess, notFound, revisionOf, type Actor } from './context.js';

function byDueDateThenCreated(a: WithId<NoteDoc>, b: WithId<NoteDoc>): number {
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  return a.createdAt.toMillis() - b.createdAt.toMillis();
}

export async function getBoard(db: Firestore, actor: Actor, boardId: string) {
  return db.runTransaction(
    async (tx) => {
      const board = liveWhiteboard(await tx.get(whiteboardsCol(db).doc(boardId)));
      const role = requireAccess(board, actor.id, ['OWNER', 'EDIT', 'VIEW']);
      return toWhiteboardDto(board!, role);
    },
    { readOnly: true },
  );
}
export async function listBoards(db: Firestore, actor: Actor) {
  return db.runTransaction(
    async (tx) => {
      const owned = docsWithId(
        await tx.get(whiteboardsCol(db).where('ownerId', '==', actor.id)),
      ).filter((board) => !board.deletedAt);
      const memberships = docsWithId(
        await tx.get(
          membersGroup(db).where('userId', '==', actor.id).where('status', '==', 'ACTIVE'),
        ),
      );
      const ids = [
        ...new Set([...owned.map((b) => b.id), ...memberships.map((m) => m.whiteboardId)]),
      ];
      const results = [];
      for (const id of ids) {
        const board = liveWhiteboard(await tx.get(whiteboardsCol(db).doc(id)));
        if (!board) continue;
        const role = board.ownerId === actor.id ? ('OWNER' as const) : board.memberRoles[actor.id];
        if (role) results.push({ id, name: board.name, currentUserRole: role });
      }
      return results;
    },
    { readOnly: true },
  );
}
async function boardSnapshot(
  db: Firestore,
  tx: Transaction,
  actor: Actor,
  boardId: string,
  ownerOnly = false,
) {
  const board = liveWhiteboard(await tx.get(whiteboardsCol(db).doc(boardId)));
  requireAccess(board, actor.id, ownerOnly ? ['OWNER'] : ['OWNER', 'EDIT', 'VIEW']);
  return board!;
}
export async function listNotes(db: Firestore, actor: Actor, boardId: string, rawQuery: unknown) {
  const query = noteListQuerySchema.parse(rawQuery);
  return db.runTransaction(
    async (tx) => {
      await boardSnapshot(db, tx, actor, boardId);
      let notes = docsWithId(
        await tx.get(notesCol(db).where('whiteboardId', '==', boardId)),
      ).filter((n) => !n.deletedAt);
      if (query.status !== 'ALL') notes = notes.filter((n) => n.status === query.status);
      if (query.priority?.length) {
        notes = notes.filter((n) => query.priority!.includes(n.priority));
      }
      if (query.horizon?.length) {
        notes = notes.filter((n) => query.horizon!.includes(n.horizon));
      }
      if (query.assignedToMe) notes = notes.filter((n) => n.assigneeId === actor.id);

      if (query.q) {
        const needle = query.q.toLowerCase();
        notes = notes.filter(
          (n) =>
            n.title.toLowerCase().includes(needle) ||
            (n.description ?? '').toLowerCase().includes(needle) ||
            n.tags.some((t) => t.toLowerCase().includes(needle)) ||
            Object.entries(n.customFields ?? {}).some(
              ([key, value]) =>
                key.toLowerCase().includes(needle) || value.toLowerCase().includes(needle),
            ),
        );
      }

      // `field` is "Kunde" (has the property) or "Kunde:Müller GmbH" (equals that value).
      // Split on the first colon only, so a value may itself contain one.
      if (query.field) {
        const separator = query.field.indexOf(':');
        const rawKey = separator === -1 ? query.field : query.field.slice(0, separator);
        const rawValue = separator === -1 ? undefined : query.field.slice(separator + 1);
        const wantedKey = normalizeFieldKey(rawKey).toLocaleLowerCase('de');
        const wantedValue = rawValue?.trim().toLocaleLowerCase('de');

        notes = notes.filter((n) =>
          Object.entries(n.customFields ?? {}).some(
            ([key, value]) =>
              normalizeFieldKey(key).toLocaleLowerCase('de') === wantedKey &&
              (wantedValue === undefined || value.toLocaleLowerCase('de') === wantedValue),
          ),
        );
      }

      notes.sort(byDueDateThenCreated);

      const users = await loadUsers(
        db,
        notes.flatMap((n) => [n.assigneeId, n.createdById]),
      );
      return notes.map((n) => toNoteDto(n, users));
    },
    { readOnly: true },
  );
}
export async function getNote(
  db: Firestore,
  actor: Actor,
  noteId: string,
  expectedBoardId?: string,
) {
  return db.runTransaction(
    async (tx) => {
      const note = withId(await tx.get(notesCol(db).doc(noteId)));
      if (!note || note.deletedAt || (expectedBoardId && note.whiteboardId !== expectedBoardId))
        notFound();
      await boardSnapshot(db, tx, actor, note.whiteboardId);
      const tasks = docsWithId(await tx.get(subtasksCol(db, noteId)));
      const history = docsWithId(await tx.get(historyCol(db, noteId)));
      return toNoteDetailDto(
        note,
        tasks,
        history,
        await loadUsers(db, [note.assigneeId, note.createdById, ...history.map((h) => h.actorId)]),
      );
    },
    { readOnly: true },
  );
}
export async function listMembers(db: Firestore, actor: Actor, boardId: string) {
  return db.runTransaction(
    async (tx) => {
      const board = await boardSnapshot(db, tx, actor, boardId);
      const members = docsWithId(
        await tx.get(membersCol(db, boardId).orderBy('invitedAt', 'asc')),
      ).filter((m) => m.userId !== board.ownerId);
      const users = await loadUsers(db, [board.ownerId, ...members.map((m) => m.userId)]);
      return {
        data: [ownerMemberDto(board, users), ...members.map((m) => toMemberDto(m, users))],
        revision: revisionOf(board),
      };
    },
    { readOnly: true },
  );
}
export async function getShareLink(db: Firestore, actor: Actor, boardId: string, baseUrl: string) {
  return db.runTransaction(
    async (tx) => {
      const board = await boardSnapshot(db, tx, actor, boardId, true);
      const link = board.shareLinkToken
        ? withId(await tx.get(shareLinksCol(db).doc(board.shareLinkToken)))
        : null;
      if (!link || link.whiteboardId !== board.id) notFound();
      return { data: toShareLinkDto(link, baseUrl), revision: revisionOf(board) };
    },
    { readOnly: true },
  );
}
export async function listTags(db: Firestore, actor: Actor, boardId: string) {
  const notes = await listNotes(db, actor, boardId, {});
  return [...new Set(notes.flatMap((n) => n.tags))].sort((a, b) =>
    a.localeCompare(b, DEFAULT_LANGUAGE),
  );
}
