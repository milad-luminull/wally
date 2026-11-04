import { eq, inArray } from 'drizzle-orm';
import type { AccountExport, NoteDto } from '@wally/shared';
import { toConversationDto } from '../assistant/conversations.js';
import { toTidyDto } from '../assistant/tidy.js';
import { listBoards, listMembers, listNotes } from '../commands/queries.js';
import { loadUsers } from '../db/records.js';
import { toHistoryEventDto, toMeDto, toSubtaskDto } from '../dto.js';
import { listConnections } from '../mcp/grants.js';
import type { Database } from '../postgres/client.js';
import {
  assistantConversations,
  assistantSuggestions,
  assistantTidies,
  assistantUsage,
  noteHistory,
  subtasks,
} from '../postgres/schema/index.js';
import type { AuthenticatedUser } from '../../plugins/auth.js';

/**
 * Everything the account can see, for GET /me/export: the same queries and DTOs the app
 * shows, so visibility rules hold (other people's private notes never appear). Subtasks and
 * history load in one query each per board, not one per note. Left out: the assistant's raw
 * model messages (the transcript entries cover them), command receipts, audit records and
 * cleanup jobs.
 */
export async function exportAccount(
  db: Database,
  user: AuthenticatedUser,
  now: Date = new Date(),
): Promise<AccountExport> {
  const boards: AccountExport['boards'] = [];
  for (const summary of await listBoards(db, user)) {
    const members = (await listMembers(db, user, summary.id)).data;
    const notes = await listNotes(db, user, summary.id, { status: 'ALL' });
    boards.push({ ...summary, members, notes: await withDetails(db, notes) });
  }
  const [usage, conversations, suggestions, tidies, connections] = await Promise.all([
    db
      .select({ day: assistantUsage.day, tokens: assistantUsage.tokens })
      .from(assistantUsage)
      .where(eq(assistantUsage.userId, user.id)),
    db.select().from(assistantConversations).where(eq(assistantConversations.userId, user.id)),
    db.select().from(assistantSuggestions).where(eq(assistantSuggestions.userId, user.id)),
    db.select().from(assistantTidies).where(eq(assistantTidies.userId, user.id)),
    listConnections(db, user.id),
  ]);
  const visible = new Set(boards.flatMap((board) => board.notes.map((note) => note.id)));
  return {
    formatVersion: 1,
    exportedAt: now.toISOString(),
    profile: toMeDto(user),
    boards,
    connections,
    assistant: {
      usage,
      conversations: conversations.map((row) => {
        // Chips are checked against what the person sees now, as the app does when it shows a
        // conversation (toVisibleConversationDto): a note since made private, deleted or on a
        // board they left drops out.
        const dto = toConversationDto(row);
        return {
          ...dto,
          entries: dto.entries.map((entry) => ({
            ...entry,
            chips: entry.chips.filter((chip) => visible.has(chip.id)),
          })),
        };
      }),
      suggestions: suggestions.map((s) => ({
        id: s.id,
        boardId: s.boardId,
        noteId: s.noteId,
        status: s.status,
        fields: s.fields,
        createdAt: s.createdAt.toISOString(),
      })),
      tidies: tidies.map(toTidyDto),
    },
  };
}

async function withDetails(db: Database, notes: NoteDto[]) {
  const ids = notes.map((n) => n.id);
  if (!ids.length) return [];
  const tasks = await db.select().from(subtasks).where(inArray(subtasks.noteId, ids));
  const history = await db.select().from(noteHistory).where(inArray(noteHistory.noteId, ids));
  const users = await loadUsers(
    db,
    history.map((h) => h.actorId),
  );
  return notes.map((note) => ({
    ...note,
    subtasks: tasks
      .filter((t) => t.noteId === note.id)
      .sort((a, b) => a.sortIndex - b.sortIndex)
      .map(toSubtaskDto),
    history: history
      .filter((h) => h.noteId === note.id)
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .map((h) => toHistoryEventDto(h, users)),
  }));
}
