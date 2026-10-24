import { randomUUID } from 'node:crypto';
import {
  FieldValue,
  Timestamp,
  type Firestore,
  type DocumentReference,
} from 'firebase-admin/firestore';
import { now, whiteboardsCol, notesCol } from '../db/collections.js';

export interface DeletionProviders {
  /** Implementations treat a provider's not-found result as success. */
  deleteFirebase(userId: string): Promise<void>;
  deleteAuth0(issuer: string, subject: string): Promise<void>;
}

/** Scrub identity references, not user-authored text. No cached user summary survives. */
function anonymize(value: unknown, userId: string, email: string): unknown {
  if (value instanceof Timestamp) return value;
  if (Array.isArray(value)) return value.map((child) => anonymize(child, userId, email));
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  if (
    record.assignee &&
    typeof record.assignee === 'object' &&
    (record.assignee as Record<string, unknown>).value === userId
  )
    return anonymize({ ...record, assignee: null }, userId, email);
  if (record.id === userId && ('email' in record || 'displayName' in record)) return null;
  return Object.fromEntries(
    Object.entries(record).map(([key, child]) => [
      key,
      (['userId', 'actorId', 'createdById', 'assigneeId', 'ownerId', 'assignee'].includes(key) &&
        child === userId) ||
      (['email', 'invitedEmail'].includes(key) && child === email)
        ? null
        : anonymize(child, userId, email),
    ]),
  );
}

async function scrubDocument(db: Firestore, ref: DocumentReference, userId: string, email: string) {
  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return;
    const data = snapshot.data()!;
    const cleaned = anonymize(data, userId, email) as Record<string, unknown>;
    if (JSON.stringify(data) !== JSON.stringify(cleaned)) tx.set(ref, cleaned);
  });
}

/** Resumable: all local operations and exact provider deletions tolerate repetition. */
export async function processAccountDeletion(
  db: Firestore,
  userId: string,
  providers: DeletionProviders,
): Promise<'pending' | 'complete'> {
  const ref = db.collection('accountDeletionJobs').doc(userId);
  const lease = randomUUID();
  const job = await db.runTransaction(async (tx) => {
    const data = (await tx.get(ref)).data();
    if (!data || data.status === 'complete') return data;
    if (data.leaseUntil?.toMillis() > Date.now()) return null;
    tx.update(ref, {
      lease,
      leaseUntil: Timestamp.fromMillis(Date.now() + 300_000),
      attempts: FieldValue.increment(1),
      updatedAt: now(),
    });
    return data;
  });
  if (job?.status === 'complete') return 'complete';
  if (!job) return 'pending';
  async function checkpoint(update: Record<string, unknown>) {
    await db.runTransaction(async (tx) => {
      const current = (await tx.get(ref)).data();
      if (current?.lease !== lease) throw new Error('Deletion lease lost');
      tx.update(ref, {
        updatedAt: now(),
        leaseUntil: Timestamp.fromMillis(Date.now() + 300_000),
        ...update,
      });
    });
  }
  try {
    const owned = await whiteboardsCol(db).where('ownerId', '==', userId).get();
    const ownedIds = [
      ...new Set<string>([...(job.ownedBoardIds ?? []), ...owned.docs.map((board) => board.id)]),
    ];
    await checkpoint({ ownedBoardIds: ownedIds });
    for (const board of owned.docs) {
      await db.runTransaction(async (tx) => {
        const current = (await tx.get(board.ref)).data();
        if (!current || current.ownerId !== userId) throw new Error('Deletion target changed');
        tx.update(board.ref, { deletedAt: now() });
      });
      for (const link of (
        await db.collection('shareLinks').where('whiteboardId', '==', board.id).get()
      ).docs)
        await link.ref.delete();
      for (const note of (await notesCol(db).where('whiteboardId', '==', board.id).get()).docs)
        await db.recursiveDelete(note.ref);
      await db.recursiveDelete(board.ref);
      await checkpoint({ phase: 'boards' });
    }
    // Read each surviving board and all its memberships in the same transaction so
    // deleting an invitation and its cached role cannot leave authorization behind.
    for (const board of (await whiteboardsCol(db).get()).docs) {
      await db.runTransaction(async (tx) => {
        const current = (await tx.get(board.ref)).data();
        const members = await tx.get(board.ref.collection('members'));
        if (!current) return;
        for (const member of members.docs)
          if (member.data().userId === userId || member.data().invitedEmail === job.email)
            tx.delete(member.ref);
        if (Object.hasOwn(current.memberRoles, userId)) {
          const roles = { ...current.memberRoles };
          delete roles[userId];
          tx.update(board.ref, {
            memberRoles: roles,
            revision: (current.revision ?? 0) + 1,
            updatedAt: now(),
          });
        }
      });
    }
    const privateNoteIds = new Set<string>(job.privateNoteIds ?? []);
    const privateBoardIds = new Set<string>(job.privateBoardIds ?? []);
    for (const row of (await notesCol(db).get()).docs) {
      const remove = await db.runTransaction(async (tx) => {
        const note = (await tx.get(row.ref)).data();
        if (!note) return false;
        if (note.createdById === userId && note.visibility === 'PRIVATE') {
          // Persist the cache cleanup targets before removing the source note.
          const boardRef = whiteboardsCol(db).doc(note.whiteboardId);
          const board = (await tx.get(boardRef)).data();
          const currentJob = (await tx.get(ref)).data();
          if (currentJob?.lease !== lease) throw new Error('Deletion lease lost');
          tx.update(ref, {
            privateNoteIds: FieldValue.arrayUnion(row.id),
            privateBoardIds: FieldValue.arrayUnion(note.whiteboardId),
          });
          if (board) tx.update(boardRef, { revision: (board.revision ?? 0) + 1, updatedAt: now() });
          tx.update(row.ref, { deletedAt: now() });
          privateNoteIds.add(row.id);
          privateBoardIds.add(note.whiteboardId);
          return true;
        }
        if (note.createdById === userId || note.assigneeId === userId)
          tx.update(row.ref, {
            createdById: note.createdById === userId ? null : note.createdById,
            assigneeId: note.assigneeId === userId ? null : note.assigneeId,
            revision: (note.revision ?? 0) + 1,
            updatedAt: now(),
          });
        return false;
      });
      if (remove) await db.recursiveDelete(row.ref);
    }
    for (const collection of [
      'history',
      'boardOperations',
      'assistantConversations',
      'assistantSuggestions',
      'assistantTidies',
    ]) {
      for (const row of (await db.collectionGroup(collection).get()).docs) {
        const data = row.data();
        const affectedBoard = ownedIds.includes(data.boardId) || privateBoardIds.has(data.boardId);
        // Model prose may contain a note without an explicit reference. Erase the
        // affected board's assistant caches; preserve authored notes and receipts.
        const affected =
          ownedIds.includes(data.boardId) ||
          (collection.startsWith('assistant') && affectedBoard) ||
          (collection === 'boardOperations' && privateNoteIds.has(data.result?.data?.id));
        if (affected) {
          if (collection === 'boardOperations') {
            // Keep the operation fingerprint, but erase cached deleted board contents.
            await row.ref.update({ 'result.data': null });
          } else await db.recursiveDelete(row.ref);
        } else await scrubDocument(db, row.ref, userId, job.email);
      }
      await checkpoint({ phase: 'references' });
    }
    for (const row of (await db.collection('assistantAudit').where('actorId', '==', userId).get())
      .docs)
      await row.ref.delete();
    for (const boardId of ownedIds)
      for (const row of (
        await db.collection('assistantAudit').where('boardId', '==', boardId).get()
      ).docs)
        await row.ref.delete();
    await db.recursiveDelete(db.collection('users').doc(userId));
    // A second sweep after the longest application request deadline removes any
    // cached references produced by a request that started before the denial.
    if (Date.now() - job.createdAt.toMillis() < 120_000) {
      await checkpoint({
        phase: 'draining',
        lease: FieldValue.delete(),
        leaseUntil: Timestamp.fromMillis(0),
      });
      return 'pending';
    }
    await checkpoint({ phase: 'providers' });
    // Stable Wally IDs of imported Firebase accounts equal their exact Firebase UID.
    // A newly-created Auth0-only Wally UUID has no Firebase identity (not-found is success).
    if (!job.firebaseDeleted) {
      await providers.deleteFirebase(userId);
      await checkpoint({ firebaseDeleted: true });
    }
    const deleted: string[] = job.auth0Deleted ?? [];
    for (const identity of job.identities) {
      const key = JSON.stringify([identity.issuer, identity.subject]);
      if (deleted.includes(key)) continue;
      await providers.deleteAuth0(identity.issuer, identity.subject);
      deleted.push(key);
      await checkpoint({ auth0Deleted: deleted });
    }
    for (const identity of (
      await db.collection('authIdentities').where('userId', '==', userId).get()
    ).docs)
      await identity.ref.delete();
    await checkpoint({
      status: 'complete',
      phase: 'complete',
      completedAt: now(),
      expiresAt: Timestamp.fromMillis(Date.now() + 30 * 86_400_000),
      ownedBoardIds: FieldValue.delete(),
      privateNoteIds: FieldValue.delete(),
      privateBoardIds: FieldValue.delete(),
      lastError: FieldValue.delete(),
      email: FieldValue.delete(),
      identities: FieldValue.delete(),
      auth0Deleted: FieldValue.delete(),
      userId: FieldValue.delete(),
      lease: FieldValue.delete(),
    });
    return 'complete';
  } catch {
    await db.runTransaction(async (tx) => {
      if ((await tx.get(ref)).data()?.lease === lease)
        tx.update(ref, {
          status: 'pending',
          lastError: 'CLEANUP_RETRY_REQUIRED',
          updatedAt: now(),
          lease: FieldValue.delete(),
          leaseUntil: FieldValue.delete(),
        });
    });
    return 'pending';
  }
}
