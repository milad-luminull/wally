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
 * Fixed user ids used only as dev fixtures. Real sign-in resolves its own user id in the auth
 * preHandler (see src/plugins/auth.ts); these seed users are reached only through a test
 * verifier, through the Auth0 E2E seed (seed-auth0-e2e.ts binds an Auth0 identity to
 * seed-owner), or as the target of the email-based auto-activation demo
 * (robin.vogt@example.com's pending invite below).
 */
const OWNER_UID = 'seed-owner';
const EDIT_COLLEAGUE_UID = 'seed-colleague-edit';
const VIEW_COLLEAGUE_UID = 'seed-colleague-view';

/**
 * The owner's first board, whose id is the owner's user id, as provisionUser in
 * src/plugins/auth.ts creates it; later boards get generated ids.
 */
const BOARD_ID = OWNER_UID;

function dateFromNow(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** German-profile demo users: the data below is English, the UI they see is German. */
async function seedUsers(db: Firestore, timestamp: Timestamp) {
  const users: [string, UserDoc][] = [
    [
      OWNER_UID,
      {
        email: 'mika.brandt@example.com',
        displayName: 'Mika Brandt',
        emailVerified: true,
        language: 'de',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    [
      EDIT_COLLEAGUE_UID,
      {
        email: 'nora.falk@example.com',
        displayName: 'Nora Falk',
        emailVerified: true,
        language: 'de',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    [
      VIEW_COLLEAGUE_UID,
      {
        email: 'deniz.kilic@example.com',
        displayName: 'Deniz Kılıç',
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
        invitedEmail: 'robin.vogt@example.com',
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

/** English content, with the English priority, horizon and colour values (ADR-0014, ADR-0024). */
function buildNoteSeeds(): NoteSeed[] {
  return [
    {
      id: 'seed-note-cyber-review',
      title: 'Cyber policy re-rating – ACME GmbH',
      priority: 'HIGH',
      horizon: 'TODAY',
      freeX: 120,
      freeY: 140,
      dueDate: dateFromNow(2),
      assigneeId: OWNER_UID,
      customFields: { Customer: 'ACME GmbH' },
      tags: ['Cyber', 'Review'],
      colour: 'ICE',
      status: 'OPEN',
      createdById: OWNER_UID,
      subtasks: [
        { text: 'Send the questionnaire to ACME', done: true },
        { text: 'Agree the limits with the underwriter', done: true },
        { text: 'Final check of the quote', done: false },
      ],
    },
    {
      id: 'seed-note-do-renewal',
      title: 'Renew the D&O contract – Nordwind Logistics',
      priority: 'HIGH',
      horizon: 'THIS_WEEK',
      freeX: 420,
      freeY: 90,
      dueDate: dateFromNow(-3), // overdue
      assigneeId: EDIT_COLLEAGUE_UID,
      customFields: { Contract: 'D&O 2024-1187' },
      tags: ['D&O', 'Renewal'],
      colour: 'STONE',
      status: 'OPEN',
      createdById: OWNER_UID,
      movedEvent: { metadata: { mode: 'PRIORITY', from: 'MEDIUM', to: 'HIGH' } },
    },
    {
      id: 'seed-note-claim-follow-up',
      title: 'Follow up the claim report – Bauer Haulage',
      priority: 'MEDIUM',
      horizon: 'TODAY',
      freeX: 760,
      freeY: 220,
      dueDate: dateFromNow(5),
      assigneeId: VIEW_COLLEAGUE_UID,
      customFields: { Claim: 'SCH-58231' },
      tags: ['Claim'],
      colour: 'SKY',
      status: 'OPEN',
      createdById: EDIT_COLLEAGUE_UID,
    },
    {
      id: 'seed-note-quote-cafe',
      title: 'Quote for business liability – Café Lindenhof',
      priority: 'LOW',
      horizon: 'LATER',
      freeX: 200,
      freeY: 520,
      dueDate: null,
      assigneeId: null, // no assignee
      customFields: { Customer: 'Café Lindenhof' },
      tags: [],
      colour: 'CHALK',
      status: 'OPEN',
      createdById: OWNER_UID,
    },
    {
      id: 'seed-note-annual-review',
      title: 'Prepare the annual review – Steiner AG',
      priority: 'MEDIUM',
      horizon: 'THIS_WEEK',
      freeX: 980,
      freeY: 460,
      dueDate: dateFromNow(7),
      assigneeId: OWNER_UID,
      customFields: { Customer: 'Steiner AG' },
      tags: ['Annual review'],
      colour: 'MINT',
      status: 'OPEN',
      createdById: OWNER_UID,
      subtasks: [
        { text: 'Export the portfolio overview', done: true },
        { text: 'Send the agenda to Steiner AG', done: false },
      ],
    },
    {
      id: 'seed-note-natural-hazard',
      title: 'Document the natural hazard claim – Hofer Construction',
      priority: 'HIGH',
      horizon: 'TODAY',
      freeX: 1320,
      freeY: 160,
      dueDate: dateFromNow(1),
      assigneeId: EDIT_COLLEAGUE_UID,
      customFields: { Claim: 'SCH-60110' },
      tags: ['Claim', 'Urgent'],
      colour: 'STONE',
      status: 'OPEN',
      createdById: EDIT_COLLEAGUE_UID,
    },
    {
      id: 'seed-note-digitise',
      title: 'Digitise the contract documents',
      priority: 'LOW',
      horizon: 'LATER',
      freeX: 640,
      freeY: 680,
      dueDate: null,
      assigneeId: OWNER_UID,
      customFields: {},
      tags: ['Internal'],
      colour: 'CHALK',
      status: 'DONE', // the DONE one
      createdById: OWNER_UID,
    },
    {
      id: 'seed-note-cyber-callback',
      title: 'Call the broker pool back about cyber cover',
      priority: 'MEDIUM',
      horizon: 'TODAY',
      freeX: 1600,
      freeY: 380,
      dueDate: dateFromNow(3),
      assigneeId: VIEW_COLLEAGUE_UID,
      customFields: { Contract: 'Cyber Package Plus' },
      tags: ['Cyber'],
      colour: 'ICE',
      status: 'OPEN',
      createdById: OWNER_UID,
    },
    {
      id: 'seed-note-renewal-list',
      title: 'Go through the Q1 renewal list',
      priority: 'LOW',
      horizon: 'THIS_WEEK',
      freeX: 300,
      freeY: 900,
      dueDate: dateFromNow(10),
      assigneeId: OWNER_UID,
      customFields: {},
      tags: ['Renewal'],
      colour: 'SKY',
      status: 'OPEN',
      createdById: OWNER_UID,
    },
    {
      id: 'seed-note-water-damage',
      title: 'Water damage claim – the Gruber family',
      priority: 'HIGH',
      horizon: 'LATER',
      freeX: 1900,
      freeY: 700,
      dueDate: dateFromNow(14),
      assigneeId: EDIT_COLLEAGUE_UID,
      customFields: { Claim: 'SCH-60250' },
      tags: ['Claim', 'Water damage'],
      colour: 'MINT',
      status: 'OPEN',
      createdById: EDIT_COLLEAGUE_UID,
      subtasks: [
        { text: 'Commission an assessor', done: true },
        { text: 'Request photos of the damage', done: false },
        { text: 'Check the confirmation of cover', done: false },
      ],
      movedEvent: { metadata: { mode: 'HORIZON', from: 'TODAY', to: 'LATER' } },
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
      revision: 1,
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
      revision: (existingBoard?.revision ?? 0) + 1,
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
    owner: 'mika.brandt@example.com',
    members: ['nora.falk@example.com', 'deniz.kilic@example.com'],
    pendingInvite: 'robin.vogt@example.com',
    shareLinkToken,
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
