import {
  Timestamp,
  type CollectionReference,
  type DocumentData,
  type DocumentSnapshot,
  type Firestore,
  type FirestoreDataConverter,
  type Query,
  type QuerySnapshot,
} from 'firebase-admin/firestore';
import {
  DEFAULT_LANGUAGE,
  boardPreferencesSchema,
  languageValues,
  preferenceBoardIdSchema,
  themePreferenceSchema,
  type Language,
  type Preferences,
} from '@wally/shared';
import type {
  HistoryEventDoc,
  MemberDoc,
  NoteDoc,
  ShareLinkDoc,
  SubtaskDoc,
  UserDoc,
  WhiteboardDoc,
  WithId,
} from './types.js';

function converter<T>(): FirestoreDataConverter<T> {
  return {
    toFirestore: (data) => data as DocumentData,
    fromFirestore: (snapshot) => snapshot.data() as T,
  };
}

export const usersCol = (db: Firestore): CollectionReference<UserDoc> =>
  db.collection('users').withConverter(converter<UserDoc>());

export const whiteboardsCol = (db: Firestore): CollectionReference<WhiteboardDoc> =>
  db.collection('whiteboards').withConverter(converter<WhiteboardDoc>());

export const membersCol = (db: Firestore, whiteboardId: string): CollectionReference<MemberDoc> =>
  whiteboardsCol(db).doc(whiteboardId).collection('members').withConverter(converter<MemberDoc>());

/** Every board's members at once — for "which boards am I a member of" style lookups. */
export const membersGroup = (db: Firestore): Query<MemberDoc> =>
  db.collectionGroup('members').withConverter(converter<MemberDoc>());

/**
 * Notes are top-level, not nested under their whiteboard, because the API routes them by
 * note id alone (`GET /notes/:id`, `requireWhiteboardAccess({kind:'noteParam'})`, …) and a
 * nested document cannot be fetched without its parent's id. The board scope lives in the
 * `whiteboardId` field instead.
 */
export const notesCol = (db: Firestore): CollectionReference<NoteDoc> =>
  db.collection('notes').withConverter(converter<NoteDoc>());

export const subtasksCol = (db: Firestore, noteId: string): CollectionReference<SubtaskDoc> =>
  notesCol(db).doc(noteId).collection('subtasks').withConverter(converter<SubtaskDoc>());

export const historyCol = (db: Firestore, noteId: string): CollectionReference<HistoryEventDoc> =>
  notesCol(db).doc(noteId).collection('history').withConverter(converter<HistoryEventDoc>());

/** Keyed by the token itself, which replaces the old unique-token constraint. */
export const shareLinksCol = (db: Firestore): CollectionReference<ShareLinkDoc> =>
  db.collection('shareLinks').withConverter(converter<ShareLinkDoc>());

/**
 * Emails are compared with exact equality because Firestore has no case-insensitive
 * matching. Every write path must run addresses through here so those comparisons hold.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * `emailVerified` reads as false unless it is explicitly true. User records written before
 * the field existed carry no value at all, and an absent flag must never be mistaken for a
 * verified address — see UserDoc.emailVerified.
 */
export function isEmailVerified(user: Pick<UserDoc, 'emailVerified'> | null | undefined): boolean {
  return user?.emailVerified === true;
}

/**
 * The stored UI language, or the default. Mirrors isEmailVerified: records written before
 * this field existed carry no value at all.
 *
 * Whitelists against languageValues rather than a bare `?? DEFAULT_LANGUAGE` because
 * Firestore validates nothing on write, so a value outside the enum is possible. Degrading
 * it to German here is much better than letting it reach meDtoSchema and turn GET /me into
 * a 500 for that one account.
 */
export function userLanguage(user: Pick<UserDoc, 'language'> | null | undefined): Language {
  const value = user?.language;
  return value !== undefined && (languageValues as readonly string[]).includes(value)
    ? value
    : DEFAULT_LANGUAGE;
}

/**
 * A profile's preferences, with every field defaulted and anything that no longer parses
 * dropped — a stored value written by an older schema must degrade to the default, never 500
 * GET /me.
 */
export function userPreferences(
  user: Pick<UserDoc, 'preferences'> | null | undefined,
): Preferences {
  const stored = user?.preferences;
  const theme = themePreferenceSchema.safeParse(stored?.theme);
  const lastBoardId = preferenceBoardIdSchema.safeParse(stored?.lastBoardId);
  const boards: Preferences['boards'] = {};
  for (const [id, value] of Object.entries(stored?.boards ?? {})) {
    const parsed = boardPreferencesSchema.safeParse(value);
    if (parsed.success && preferenceBoardIdSchema.safeParse(id).success) boards[id] = parsed.data;
  }
  return {
    theme: theme.success ? theme.data : 'system',
    lastBoardId: lastBoardId.success ? lastBoardId.data : null,
    boards,
  };
}

export const now = (): Timestamp => Timestamp.now();

export const toIso = (value: Timestamp): string => value.toDate().toISOString();

export const toIsoOrNull = (value: Timestamp | null): string | null =>
  value ? toIso(value) : null;

export function withId<T>(snapshot: DocumentSnapshot<T>): WithId<T> | null {
  const data = snapshot.data();
  if (!data) return null;
  return { ...data, id: snapshot.id };
}

export function docsWithId<T>(snapshot: QuerySnapshot<T>): WithId<T>[] {
  return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
}

/** Drops the read-side `id` again so a value can be written back as document data. */
export function stripId<T>(value: WithId<T>): T {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'id')) as T;
}

/**
 * Batch-loads the users behind a set of ids in one round trip, skipping nulls and
 * duplicates. NoteDto embeds a UserSummary for both assignee and creator, and MemberDto
 * needs one per row; resolving them individually would be a read per note.
 *
 * Deliberately not denormalized onto the note — email and display name change, and a
 * copy on every note would go stale.
 */
export async function loadUsers(
  db: Firestore,
  ids: (string | null | undefined)[],
): Promise<Map<string, WithId<UserDoc>>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const users = new Map<string, WithId<UserDoc>>();
  if (unique.length === 0) return users;

  const snapshots = await db.getAll(...unique.map((id) => usersCol(db).doc(id)));
  for (const snapshot of snapshots) {
    const user = withId(snapshot as DocumentSnapshot<UserDoc>);
    if (user) users.set(user.id, user);
  }
  return users;
}
