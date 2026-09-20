import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { INITIAL_BOARD_NAME } from '@wally/shared';
import type { NoteColour, NoteHorizon, NotePriority, NoteStatus } from '@wally/shared';
import type { MemberDoc, NoteDoc, UserDoc } from './lib/db/types.js';
import {
  historyCol,
  membersCol,
  notesCol,
  now,
  shareLinksCol,
  subtasksCol,
  usersCol,
  whiteboardsCol,
  withId,
} from './lib/db/collections.js';
import { getDb } from './lib/db/client.js';
import { generateShareToken } from './lib/tokens.js';

/**
 * Fixed fake Firebase UIDs used only as dev fixtures. Real sign-in creates real UIDs via
 * the auth preHandler (see src/plugins/auth.ts) — these seed users only show up when
 * Firebase auth is bypassed/mocked in local dev, or as the target of the email-based
 * auto-activation demo (lena.hofer@finlex.de's pending invite below).
 */
const OWNER_UID = 'seed-owner';
const EDIT_COLLEAGUE_UID = 'seed-colleague-edit';
const VIEW_COLLEAGUE_UID = 'seed-colleague-view';

/** The board's document id IS its owner's uid — see WhiteboardDoc. */
const BOARD_ID = OWNER_UID;

function dateFromNow(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function seedUsers(db: Firestore, timestamp: Timestamp) {
  const users: [string, UserDoc][] = [
    [
      OWNER_UID,
      {
        email: 'max.berger@finlex.de',
        displayName: 'Max Berger',
        emailVerified: true,
        language: 'de',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    [
      EDIT_COLLEAGUE_UID,
      {
        email: 'andrea.reiter@finlex.de',
        displayName: 'Andrea Reiter',
        emailVerified: true,
        language: 'de',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    [
      VIEW_COLLEAGUE_UID,
      {
        email: 'irem.yildiz@finlex.de',
        displayName: 'Irem Yıldız',
        emailVerified: true,
        language: 'de',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
  ];
  await Promise.all(users.map(([id, user]) => usersCol(db).doc(id).set(user)));
}

async function seedMembers(db: Firestore, timestamp: Timestamp) {
  const members: [string, MemberDoc][] = [
    [
      'seed-member-edit',
      {
        whiteboardId: BOARD_ID,
        userId: EDIT_COLLEAGUE_UID,
        invitedEmail: null,
        role: 'EDIT',
        status: 'ACTIVE',
        invitedAt: timestamp,
        activatedAt: timestamp,
      },
    ],
    [
      'seed-member-view',
      {
        whiteboardId: BOARD_ID,
        userId: VIEW_COLLEAGUE_UID,
        invitedEmail: null,
        role: 'VIEW',
        status: 'ACTIVE',
        invitedAt: timestamp,
        activatedAt: timestamp,
      },
    ],
    [
      'seed-member-pending',
      {
        whiteboardId: BOARD_ID,
        userId: null,
        invitedEmail: 'lena.hofer@finlex.de',
        role: 'VIEW',
        status: 'PENDING',
        invitedAt: timestamp,
        activatedAt: null,
      },
    ],
  ];
  await Promise.all(members.map(([id, member]) => membersCol(db, BOARD_ID).doc(id).set(member)));
}

interface NoteSeed {
  id: string;
  title: string;
  priority: NotePriority;
  horizon: NoteHorizon;
  freeX: number;
  freeY: number;
  dueDate: string | null;
  assigneeId: string | null;
  tags: string[];
  customFields: Record<string, string>;
  colour: NoteColour;
  status: NoteStatus;
  createdById: string | null;
  subtasks?: { text: string; done: boolean }[];
  /** When set, adds a second MOVED history event on top of the CREATED one. */
  movedEvent?: { metadata: Record<string, unknown> };
}

function buildNoteSeeds(): NoteSeed[] {
  return [
    {
      id: 'seed-note-cyber-review',
      title: 'Cyber-Police Neubewertung – ACME GmbH',
      priority: 'HOCH',
      horizon: 'HEUTE',
      freeX: 120,
      freeY: 140,
      dueDate: dateFromNow(2),
      assigneeId: OWNER_UID,
      customFields: { Kunde: 'ACME GmbH' },
      tags: ['Cyber', 'Review'],
      colour: 'EIS',
      status: 'OPEN',
      createdById: OWNER_UID,
      subtasks: [
        { text: 'Fragebogen an ACME senden', done: true },
        { text: 'Deckungssummen mit Underwriter abstimmen', done: true },
        { text: 'Angebot final prüfen', done: false },
      ],
    },
    {
      id: 'seed-note-do-renewal',
      title: 'D&O-Vertrag verlängern – Nordwind Logistik',
      priority: 'HOCH',
      horizon: 'DIESE_WOCHE',
      freeX: 420,
      freeY: 90,
      dueDate: dateFromNow(-3), // overdue
      assigneeId: EDIT_COLLEAGUE_UID,
      customFields: { Vertrag: 'D&O 2024-1187' },
      tags: ['D&O', 'Verlängerung'],
      colour: 'SAND',
      status: 'OPEN',
      createdById: OWNER_UID,
      movedEvent: { metadata: { mode: 'PRIORITY', from: 'MITTEL', to: 'HOCH' } },
    },
    {
      id: 'seed-note-schaden-nachfassen',
      title: 'Schadenmeldung nachfassen – Bauer Spedition',
      priority: 'MITTEL',
      horizon: 'HEUTE',
      freeX: 760,
      freeY: 220,
      dueDate: dateFromNow(5),
      assigneeId: VIEW_COLLEAGUE_UID,
      customFields: { Schaden: 'SCH-58231' },
      tags: ['Schaden'],
      colour: 'HIMMEL',
      status: 'OPEN',
      createdById: EDIT_COLLEAGUE_UID,
    },
    {
      id: 'seed-note-angebot-cafe',
      title: 'Angebot Gewerbehaftpflicht – Café Lindenhof',
      priority: 'NIEDRIG',
      horizon: 'SPAETER',
      freeX: 200,
      freeY: 520,
      dueDate: null,
      assigneeId: null, // no assignee
      customFields: { Kunde: 'Café Lindenhof' },
      tags: [],
      colour: 'WEISS',
      status: 'OPEN',
      createdById: OWNER_UID,
    },
    {
      id: 'seed-note-jahresgespraech',
      title: 'Jahresgespräch vorbereiten – Steiner AG',
      priority: 'MITTEL',
      horizon: 'DIESE_WOCHE',
      freeX: 980,
      freeY: 460,
      dueDate: dateFromNow(7),
      assigneeId: OWNER_UID,
      customFields: { Kunde: 'Steiner AG' },
      tags: ['Jahresgespräch'],
      colour: 'MINZE',
      status: 'OPEN',
      createdById: OWNER_UID,
      subtasks: [
        { text: 'Bestandsübersicht exportieren', done: true },
        { text: 'Agenda an Steiner AG senden', done: false },
      ],
    },
    {
      id: 'seed-note-elementarschaden',
      title: 'Elementarschaden dokumentieren – Hofer Bau',
      priority: 'HOCH',
      horizon: 'HEUTE',
      freeX: 1320,
      freeY: 160,
      dueDate: dateFromNow(1),
      assigneeId: EDIT_COLLEAGUE_UID,
      customFields: { Schaden: 'SCH-60110' },
      tags: ['Schaden', 'Dringend'],
      colour: 'SAND',
      status: 'OPEN',
      createdById: EDIT_COLLEAGUE_UID,
    },
    {
      id: 'seed-note-digitalisieren',
      title: 'Vertragsunterlagen digitalisieren',
      priority: 'NIEDRIG',
      horizon: 'SPAETER',
      freeX: 640,
      freeY: 680,
      dueDate: null,
      assigneeId: OWNER_UID,
      customFields: {},
      tags: ['Intern'],
      colour: 'WEISS',
      status: 'DONE', // the DONE one
      createdById: OWNER_UID,
    },
    {
      id: 'seed-note-rueckruf-cyber',
      title: 'Rückruf Maklerpool wegen Cyberdeckung',
      priority: 'MITTEL',
      horizon: 'HEUTE',
      freeX: 1600,
      freeY: 380,
      dueDate: dateFromNow(3),
      assigneeId: VIEW_COLLEAGUE_UID,
      customFields: { Vertrag: 'Cyber-Paket Plus' },
      tags: ['Cyber'],
      colour: 'EIS',
      status: 'OPEN',
      createdById: OWNER_UID,
    },
    {
      id: 'seed-note-renewal-liste',
      title: 'Renewal-Liste Q1 durchgehen',
      priority: 'NIEDRIG',
      horizon: 'DIESE_WOCHE',
      freeX: 300,
      freeY: 900,
      dueDate: dateFromNow(10),
      assigneeId: OWNER_UID,
      customFields: {},
      tags: ['Renewal'],
      colour: 'HIMMEL',
      status: 'OPEN',
      createdById: OWNER_UID,
    },
    {
      id: 'seed-note-wasserschaden',
      title: 'Schadenfall Wasserschaden – Familie Gruber',
      priority: 'HOCH',
      horizon: 'SPAETER',
      freeX: 1900,
      freeY: 700,
      dueDate: dateFromNow(14),
      assigneeId: EDIT_COLLEAGUE_UID,
      customFields: { Schaden: 'SCH-60250' },
      tags: ['Schaden', 'Wasserschaden'],
      colour: 'MINZE',
      status: 'OPEN',
      createdById: EDIT_COLLEAGUE_UID,
      subtasks: [
        { text: 'Gutachter beauftragen', done: true },
        { text: 'Fotos vom Schaden anfordern', done: false },
        { text: 'Deckungszusage prüfen', done: false },
      ],
      movedEvent: { metadata: { mode: 'HORIZON', from: 'HEUTE', to: 'SPAETER' } },
    },
  ];
}

async function seedNotes(db: Firestore, timestamp: Timestamp) {
  for (const seed of buildNoteSeeds()) {
    const subtasks = seed.subtasks ?? [];
    const note: NoteDoc = {
      whiteboardId: BOARD_ID,
      title: seed.title,
      status: seed.status,
      completedAt: seed.status === 'DONE' ? timestamp : null,
      priority: seed.priority,
      horizon: seed.horizon,
      freeX: seed.freeX,
      freeY: seed.freeY,
      dueDate: seed.dueDate,
      assigneeId: seed.assigneeId,
      tags: seed.tags,
      customFields: seed.customFields,
      colour: seed.colour,
      createdById: seed.createdById,
      subtaskSummary: { total: subtasks.length, done: subtasks.filter((s) => s.done).length },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await notesCol(db).doc(seed.id).set(note);

    // Subtasks and history are re-derived from the seed definition on every run — the
    // simplest way to stay idempotent without a natural key per child document.
    await Promise.all([
      db.recursiveDelete(subtasksCol(db, seed.id)),
      db.recursiveDelete(historyCol(db, seed.id)),
    ]);

    const batch = db.batch();
    subtasks.forEach((subtask, index) => {
      batch.set(subtasksCol(db, seed.id).doc(), {
        noteId: seed.id,
        text: subtask.text,
        done: subtask.done,
        sortIndex: index,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });
    batch.set(historyCol(db, seed.id).doc(), {
      noteId: seed.id,
      type: 'CREATED',
      occurredAt: timestamp,
      actorId: seed.createdById,
      metadata: null,
    });
    if (seed.movedEvent) {
      batch.set(historyCol(db, seed.id).doc(), {
        noteId: seed.id,
        type: 'MOVED',
        occurredAt: timestamp,
        actorId: seed.assigneeId ?? seed.createdById,
        metadata: seed.movedEvent.metadata,
      });
    }
    await batch.commit();
  }
}

async function main() {
  const db = getDb();
  const timestamp = now();

  // Keep whatever share token a previous run generated: the URL may already be in
  // someone's clipboard, and a predictable literal has no business in source control.
  const existingBoard = withId(await whiteboardsCol(db).doc(BOARD_ID).get());
  const shareLinkToken = existingBoard?.shareLinkToken ?? generateShareToken();

  await seedUsers(db, timestamp);

  await whiteboardsCol(db)
    .doc(BOARD_ID)
    .set({
      name: INITIAL_BOARD_NAME.de,
      ownerId: OWNER_UID,
      memberRoles: { [EDIT_COLLEAGUE_UID]: 'EDIT', [VIEW_COLLEAGUE_UID]: 'VIEW' },
      shareLinkToken,
      createdAt: existingBoard?.createdAt ?? timestamp,
      updatedAt: timestamp,
    });

  await shareLinksCol(db).doc(shareLinkToken).set({
    whiteboardId: BOARD_ID,
    role: 'VIEW',
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await seedMembers(db, timestamp);
  await seedNotes(db, timestamp);

  console.log('Seed complete:', {
    board: INITIAL_BOARD_NAME.de,
    owner: 'max.berger@finlex.de',
    members: ['andrea.reiter@finlex.de', 'irem.yildiz@finlex.de'],
    pendingInvite: 'lena.hofer@finlex.de',
    shareLinkToken,
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
