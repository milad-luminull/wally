import { eq, inArray, sql } from 'drizzle-orm';
import { INITIAL_BOARD_NAME } from '@wally/shared';
import type { NoteColour, NoteHorizon, NotePriority, NoteStatus } from '@wally/shared';
import { loadEnv } from './env.js';
import { newId } from './lib/db/ids.js';
import { createDatabase, type Database } from './lib/postgres/client.js';
import { withTransaction, type Transaction } from './lib/postgres/transaction.js';
import {
  boardMembers,
  noteHistory,
  notes,
  shareLinks,
  subtasks,
  users,
  whiteboards,
} from './lib/postgres/schema/index.js';
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
async function seedUsers(tx: Transaction, timestamp: Date) {
  const rows: (typeof users.$inferInsert)[] = [
    [OWNER_UID, 'mika.brandt@example.com', 'Mika Brandt'],
    [EDIT_COLLEAGUE_UID, 'nora.falk@example.com', 'Nora Falk'],
    [VIEW_COLLEAGUE_UID, 'deniz.kilic@example.com', 'Deniz Kılıç'],
  ].map(([id, email, displayName]) => ({
    id: id!,
    email: email!,
    displayName: displayName!,
    emailVerified: true,
    language: 'de',
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
  await tx
    .insert(users)
    .values(rows)
    .onConflictDoUpdate({
      target: users.id,
      set: {
        email: sql`excluded.email`,
        displayName: sql`excluded.display_name`,
        emailVerified: true,
        language: 'de',
        updatedAt: timestamp,
      },
    });
}

async function seedMembers(tx: Transaction, timestamp: Date) {
  const rows: (typeof boardMembers.$inferInsert)[] = [
    { id: 'seed-member-edit', userId: EDIT_COLLEAGUE_UID, role: 'EDIT', status: 'ACTIVE' },
    { id: 'seed-member-view', userId: VIEW_COLLEAGUE_UID, role: 'VIEW', status: 'ACTIVE' },
    {
      id: 'seed-member-pending',
      invitedEmail: 'robin.vogt@example.com',
      role: 'VIEW',
      status: 'PENDING',
    },
  ].map((member) => ({
    userId: null,
    invitedEmail: null,
    ...member,
    boardId: BOARD_ID,
    invitedAt: timestamp,
    activatedAt: member.status === 'ACTIVE' ? timestamp : null,
  })) as (typeof boardMembers.$inferInsert)[];
  // Re-created from the definition on every run, like the notes' children below.
  await tx.delete(boardMembers).where(
    inArray(
      boardMembers.id,
      rows.map((row) => row.id),
    ),
  );
  await tx.insert(boardMembers).values(rows);
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

async function seedNotes(tx: Transaction, timestamp: Date) {
  const seeds = buildNoteSeeds();
  // Notes are re-created from the seed definition on every run, children included — the
  // simplest way to stay idempotent without a natural key per subtask or history event.
  await tx.delete(notes).where(
    inArray(
      notes.id,
      seeds.map((seed) => seed.id),
    ),
  );
  for (const seed of seeds) {
    await tx.insert(notes).values({
      id: seed.id,
      boardId: BOARD_ID,
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
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const tasks = seed.subtasks ?? [];
    if (tasks.length > 0)
      await tx.insert(subtasks).values(
        tasks.map((subtask, index) => ({
          id: newId(),
          noteId: seed.id,
          text: subtask.text,
          done: subtask.done,
          sortIndex: index,
          createdAt: timestamp,
          updatedAt: timestamp,
        })),
      );
    await tx.insert(noteHistory).values([
      {
        id: newId(),
        noteId: seed.id,
        type: 'CREATED',
        occurredAt: timestamp,
        actorId: seed.createdById,
        metadata: null,
      },
      ...(seed.movedEvent
        ? [
            {
              id: newId(),
              noteId: seed.id,
              type: 'MOVED' as const,
              occurredAt: timestamp,
              actorId: seed.assigneeId ?? seed.createdById,
              metadata: seed.movedEvent.metadata,
            },
          ]
        : []),
    ]);
  }
}

/** Writes the demo board, its people and notes; safe to run again. Returns the share token. */
export async function seedDemo(db: Database): Promise<string> {
  return withTransaction(db, async (tx) => {
    const timestamp = new Date();
    await seedUsers(tx, timestamp);

    const [existingBoard] = await tx
      .select()
      .from(whiteboards)
      .where(eq(whiteboards.id, BOARD_ID));
    await tx
      .insert(whiteboards)
      .values({
        id: BOARD_ID,
        name: INITIAL_BOARD_NAME.de,
        ownerId: OWNER_UID,
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .onConflictDoUpdate({
        target: whiteboards.id,
        set: {
          name: INITIAL_BOARD_NAME.de,
          ownerId: OWNER_UID,
          deletedAt: null,
          revision: (existingBoard?.revision ?? 0) + 1,
          updatedAt: timestamp,
        },
      });

    // Keep whatever share token a previous run generated: the URL may already be in
    // someone's clipboard, and a predictable literal has no business in source control.
    const [existingLink] = await tx
      .select()
      .from(shareLinks)
      .where(eq(shareLinks.boardId, BOARD_ID));
    const shareLinkToken = existingLink?.token ?? generateShareToken();
    if (!existingLink)
      await tx.insert(shareLinks).values({
        token: shareLinkToken,
        boardId: BOARD_ID,
        role: 'VIEW',
        createdAt: timestamp,
        updatedAt: timestamp,
      });

    await seedMembers(tx, timestamp);
    await seedNotes(tx, timestamp);
    return shareLinkToken;
  });
}

async function main() {
  const { db, close } = createDatabase(loadEnv().DATABASE_URL);
  try {
    const shareLinkToken = await seedDemo(db);
    console.log('Seed complete:', {
      board: INITIAL_BOARD_NAME.de,
      owner: 'mika.brandt@example.com',
      members: ['nora.falk@example.com', 'deniz.kilic@example.com'],
      pendingInvite: 'robin.vogt@example.com',
      shareLinkToken,
    });
  } finally {
    await close();
  }
}

// Run only as a script, not when a test imports seedDemo.
if (import.meta.url === `file://${process.argv[1]}`)
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
