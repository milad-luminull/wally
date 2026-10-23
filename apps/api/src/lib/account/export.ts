import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { AuthenticatedUser } from '../../plugins/auth.js';
import { getBoard, getNote, listBoards, listMembers, listNotes } from '../commands/queries.js';
import { toMeDto } from '../dto.js';
import { listConnections } from '../mcp/grants.js';

/** Export public DTOs, never raw board/note records or provider credentials. */
export async function exportAccount(db: Firestore, user: AuthenticatedUser) {
  const boards = [];
  for (const board of await listBoards(db, user)) {
    const detail = await getBoard(db, user, board.id);
    const notes = [];
    for (const note of await listNotes(db, user, board.id, { status: 'ALL' })) {
      notes.push(await getNote(db, user, note.id, board.id));
    }
    const memberships = (await listMembers(db, user, board.id)).data.filter(
      (member) => member.userId === user.id,
    );
    // Fail closed if access was removed while assembling this board's download.
    await getBoard(db, user, board.id);
    boards.push({ ...detail, memberships, notes });
  }
  const connections = (await listConnections(db, user.id)).map((connection) => ({
    id: connection.id,
    clientId: connection.clientId,
    name: connection.name,
    scopes: connection.scopes,
    createdAt: connection.createdAt,
    revokedAt: connection.revokedAt,
  }));
  const identities = await records(db.collection('authIdentities').where('userId', '==', user.id), [
    'issuer',
    'subject',
  ]);
  const audit = await records(db.collection('assistantAudit').where('actorId', '==', user.id), [
    'operationId',
    'boardId',
    'targetId',
    'commandType',
    'conversationId',
    'approvalId',
    'via',
    'connectionId',
    'revision',
    'occurredAt',
  ]);
  const root = db.collection('users').doc(user.id);
  const mcp = (await root.collection('mcpLimits').get()).docs.map((doc) => ({
    kind: doc.id,
    ...pick(doc.data(), ['window', 'count', 'connections']),
  }));
  const assistant = await records(root.collection('assistantAttempts'), [
    'day',
    'month',
    'reservedTokens',
    'reservedMicroUsd',
    'state',
    'settledTokens',
    'settledMicroUsd',
    'createdAt',
    'settledAt',
  ]);
  const operations = await records(root.collection('boardOperations'), [
    'boardId',
    'createdAt',
    'expiresAt',
  ]);
  const visibleBoards = new Set(boards.map((board) => board.id));
  const visibleNotes = new Set(boards.flatMap((board) => board.notes.map((note) => note.id)));
  const history = async (collection: string) =>
    (await root.collection(collection).get()).docs.filter((doc) =>
      visibleBoards.has(doc.data().boardId),
    );
  const conversations = (await history('assistantConversations')).map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      ...pick(data, ['boardId', 'status', 'turns', 'model', 'createdAt', 'lastTurnAt']),
      entries: (data.entries ?? []).map((entry: Record<string, unknown>) => ({
        ...pick(entry, ['role', 'partial', 'stopped', 'at']),
        // Generated prose has no complete source provenance: a note may now be private.
        // Keep the user's own words and the event, never opaque SDK messages/tool results.
        ...(entry.role === 'user'
          ? { text: entry.text }
          : { text: null, redacted: 'generated_content_without_current_visibility_proof' }),
      })),
    };
  });
  const decisions = async (collection: string) =>
    (await history(collection)).map((doc) => {
      const data = doc.data();
      const decision = (value: Record<string, unknown> | null) =>
        value ? pick(value, ['source', 'fields', 'at']) : null;
      return {
        id: doc.id,
        ...pick(data, ['boardId', 'status', 'createdAt', 'updatedAt']),
        ...(visibleNotes.has(data.noteId) ? { noteId: data.noteId } : {}),
        decision: decision(data.decision),
        undone: decision(data.undone),
        redacted: 'generated_content_without_current_visibility_proof',
      };
    });
  const assistantHistory = {
    conversations,
    suggestions: await decisions('assistantSuggestions'),
    tidies: await decisions('assistantTidies'),
  };
  const assistantDaily = (await root.collection('assistantUsage').get()).docs.map((doc) => ({
    day: doc.id,
    ...pick(doc.data(), ['tokens', 'updatedAt']),
  }));
  // Recheck membership after collecting historical records as well.
  for (const board of boards) await getBoard(db, user, board.id);
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    profile: toMeDto(user),
    boards,
    connections,
    identities,
    audit,
    usage: { mcp, assistant, assistantDaily },
    assistantHistory,
    operations,
  };
}

function jsonValue(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, jsonValue(child)]));
  return value;
}
function pick(data: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(
    keys.filter((key) => data[key] !== undefined).map((key) => [key, jsonValue(data[key])]),
  );
}
async function records(query: FirebaseFirestore.Query, keys: string[]) {
  return (await query.get()).docs.map((doc) => pick(doc.data(), keys));
}
