import {
  PrismaClient,
  type NoteColour,
  type NoteHorizon,
  type NotePriority,
  type Prisma,
  type ReferenceType,
} from './generated/client/index.js';
import { generateShareToken } from '../src/lib/tokens.js';

const prisma = new PrismaClient();

/**
 * Fixed fake Firebase UIDs used only as dev fixtures. Real sign-in creates real UIDs via
 * the auth preHandler's upsert (see src/plugins/auth.ts) — these seed users only show up
 * when Firebase auth is bypassed/mocked in local dev, or as the target of the
 * email-based auto-activation demo (lena.hofer@finlex.de's pending invite below).
 */
const OWNER_UID = 'seed-owner';
const EDIT_COLLEAGUE_UID = 'seed-colleague-edit';
const VIEW_COLLEAGUE_UID = 'seed-colleague-view';

function daysFromNow(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

async function upsertReferenceOptions() {
  const options: { type: ReferenceType; label: string }[] = [
    // KUNDE — clients
    { type: 'KUNDE', label: 'ACME GmbH' },
    { type: 'KUNDE', label: 'Nordwind Logistik AG' },
    { type: 'KUNDE', label: 'Bauer Spedition KG' },
    { type: 'KUNDE', label: 'Café Lindenhof' },
    { type: 'KUNDE', label: 'Steiner AG' },
    // VERTRAG — contracts
    { type: 'VERTRAG', label: 'D&O 2024-1187' },
    { type: 'VERTRAG', label: 'Cyber-Paket Plus' },
    { type: 'VERTRAG', label: 'Gewerbehaftpflicht Basis' },
    { type: 'VERTRAG', label: 'Gebäudeversicherung Süd' },
    { type: 'VERTRAG', label: 'Flottenversicherung 2025' },
    // SCHADEN — claims
    { type: 'SCHADEN', label: 'SCH-58231' },
    { type: 'SCHADEN', label: 'SCH-60110' },
    { type: 'SCHADEN', label: 'SCH-60250' },
    { type: 'SCHADEN', label: 'SCH-59902' },
    { type: 'SCHADEN', label: 'SCH-61030' },
  ];

  for (const option of options) {
    await prisma.referenceOption.upsert({
      where: { type_label: { type: option.type, label: option.label } },
      update: {},
      create: option,
    });
  }
}

interface NoteSeed {
  id: string;
  title: string;
  priority: NotePriority;
  horizon: NoteHorizon;
  freeX: number;
  freeY: number;
  dueDate: Date | null;
  assigneeId: string | null;
  referenceType: ReferenceType | null;
  referenceLabel: string | null;
  tags: string[];
  colour: NoteColour;
  status: 'OPEN' | 'DONE';
  createdById: string | null;
  subtasks?: { text: string; done: boolean }[];
  /** When set, adds a second MOVED history event on top of the CREATED one. */
  movedEvent?: { mode: 'HORIZON' | 'PRIORITY' | 'FREE'; metadata: Prisma.InputJsonObject };
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
      dueDate: daysFromNow(2),
      assigneeId: OWNER_UID,
      referenceType: 'KUNDE',
      referenceLabel: 'ACME GmbH',
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
      dueDate: daysFromNow(-3), // overdue
      assigneeId: EDIT_COLLEAGUE_UID,
      referenceType: 'VERTRAG',
      referenceLabel: 'D&O 2024-1187',
      tags: ['D&O', 'Verlängerung'],
      colour: 'SAND',
      status: 'OPEN',
      createdById: OWNER_UID,
      movedEvent: {
        mode: 'PRIORITY',
        metadata: { mode: 'PRIORITY', from: 'MITTEL', to: 'HOCH' },
      },
    },
    {
      id: 'seed-note-schaden-nachfassen',
      title: 'Schadenmeldung nachfassen – Bauer Spedition',
      priority: 'MITTEL',
      horizon: 'HEUTE',
      freeX: 760,
      freeY: 220,
      dueDate: daysFromNow(5),
      assigneeId: VIEW_COLLEAGUE_UID,
      referenceType: 'SCHADEN',
      referenceLabel: 'SCH-58231',
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
      referenceType: 'KUNDE',
      referenceLabel: 'Café Lindenhof',
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
      dueDate: daysFromNow(7),
      assigneeId: OWNER_UID,
      referenceType: 'KUNDE',
      referenceLabel: 'Steiner AG',
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
      dueDate: daysFromNow(1),
      assigneeId: EDIT_COLLEAGUE_UID,
      referenceType: 'SCHADEN',
      referenceLabel: 'SCH-60110',
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
      referenceType: null,
      referenceLabel: null,
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
      dueDate: daysFromNow(3),
      assigneeId: VIEW_COLLEAGUE_UID,
      referenceType: 'VERTRAG',
      referenceLabel: 'Cyber-Paket Plus',
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
      dueDate: daysFromNow(10),
      assigneeId: OWNER_UID,
      referenceType: null,
      referenceLabel: null,
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
      dueDate: daysFromNow(14),
      assigneeId: EDIT_COLLEAGUE_UID,
      referenceType: 'SCHADEN',
      referenceLabel: 'SCH-60250',
      tags: ['Schaden', 'Wasserschaden'],
      colour: 'MINZE',
      status: 'OPEN',
      createdById: EDIT_COLLEAGUE_UID,
      subtasks: [
        { text: 'Gutachter beauftragen', done: true },
        { text: 'Fotos vom Schaden anfordern', done: false },
        { text: 'Deckungszusage prüfen', done: false },
      ],
      movedEvent: {
        mode: 'HORIZON',
        metadata: { mode: 'HORIZON', from: 'HEUTE', to: 'SPAETER' },
      },
    },
  ];
}

async function upsertNotes(boardId: string) {
  for (const seed of buildNoteSeeds()) {
    const note = await prisma.note.upsert({
      where: { id: seed.id },
      update: {
        whiteboardId: boardId,
        title: seed.title,
        priority: seed.priority,
        horizon: seed.horizon,
        freeX: seed.freeX,
        freeY: seed.freeY,
        dueDate: seed.dueDate,
        assigneeId: seed.assigneeId,
        referenceType: seed.referenceType,
        referenceLabel: seed.referenceLabel,
        tags: seed.tags,
        colour: seed.colour,
        status: seed.status,
        completedAt: seed.status === 'DONE' ? new Date() : null,
        createdById: seed.createdById,
      },
      create: {
        id: seed.id,
        whiteboardId: boardId,
        title: seed.title,
        priority: seed.priority,
        horizon: seed.horizon,
        freeX: seed.freeX,
        freeY: seed.freeY,
        dueDate: seed.dueDate,
        assigneeId: seed.assigneeId,
        referenceType: seed.referenceType,
        referenceLabel: seed.referenceLabel,
        tags: seed.tags,
        colour: seed.colour,
        status: seed.status,
        completedAt: seed.status === 'DONE' ? new Date() : null,
        createdById: seed.createdById,
      },
    });

    // Subtasks and history are re-derived from the seed definition on every run —
    // simplest way to keep this idempotent without a separate natural key per child row.
    await prisma.subtask.deleteMany({ where: { noteId: note.id } });
    if (seed.subtasks) {
      let sortIndex = 0;
      for (const subtask of seed.subtasks) {
        await prisma.subtask.create({
          data: { noteId: note.id, text: subtask.text, done: subtask.done, sortIndex: sortIndex++ },
        });
      }
    }

    await prisma.noteHistoryEvent.deleteMany({ where: { noteId: note.id } });
    await prisma.noteHistoryEvent.create({
      data: { noteId: note.id, type: 'CREATED', actorId: seed.createdById },
    });
    if (seed.movedEvent) {
      await prisma.noteHistoryEvent.create({
        data: {
          noteId: note.id,
          type: 'MOVED',
          actorId: seed.assigneeId ?? seed.createdById,
          metadata: seed.movedEvent.metadata,
        },
      });
    }
  }
}

async function main() {
  const owner = await prisma.user.upsert({
    where: { id: OWNER_UID },
    update: { email: 'max.berger@finlex.de', displayName: 'Max Berger' },
    create: { id: OWNER_UID, email: 'max.berger@finlex.de', displayName: 'Max Berger' },
  });

  const editColleague = await prisma.user.upsert({
    where: { id: EDIT_COLLEAGUE_UID },
    update: { email: 'andrea.reiter@finlex.de', displayName: 'Andrea Reiter' },
    create: { id: EDIT_COLLEAGUE_UID, email: 'andrea.reiter@finlex.de', displayName: 'Andrea Reiter' },
  });

  const viewColleague = await prisma.user.upsert({
    where: { id: VIEW_COLLEAGUE_UID },
    update: { email: 'irem.yildiz@finlex.de', displayName: 'Irem Yıldız' },
    create: { id: VIEW_COLLEAGUE_UID, email: 'irem.yildiz@finlex.de', displayName: 'Irem Yıldız' },
  });

  const board = await prisma.whiteboard.upsert({
    where: { ownerId: owner.id },
    update: { name: 'Meine Wand' },
    create: { ownerId: owner.id, name: 'Meine Wand' },
  });

  await prisma.whiteboardMember.upsert({
    where: { whiteboardId_userId: { whiteboardId: board.id, userId: editColleague.id } },
    update: { role: 'EDIT', status: 'ACTIVE' },
    create: {
      whiteboardId: board.id,
      userId: editColleague.id,
      role: 'EDIT',
      status: 'ACTIVE',
      activatedAt: new Date(),
    },
  });

  await prisma.whiteboardMember.upsert({
    where: { whiteboardId_userId: { whiteboardId: board.id, userId: viewColleague.id } },
    update: { role: 'VIEW', status: 'ACTIVE' },
    create: {
      whiteboardId: board.id,
      userId: viewColleague.id,
      role: 'VIEW',
      status: 'ACTIVE',
      activatedAt: new Date(),
    },
  });

  await prisma.whiteboardMember.upsert({
    where: {
      whiteboardId_invitedEmail: { whiteboardId: board.id, invitedEmail: 'lena.hofer@finlex.de' },
    },
    update: { role: 'VIEW', status: 'PENDING' },
    create: {
      whiteboardId: board.id,
      invitedEmail: 'lena.hofer@finlex.de',
      role: 'VIEW',
      status: 'PENDING',
    },
  });

  // `create` only runs the first time this seed executes for this board — a random token
  // generated here is fine to keep across reruns since `update` never touches it, and
  // avoids checking a predictable, guessable literal into source control.
  const shareLink = await prisma.shareLink.upsert({
    where: { whiteboardId: board.id },
    update: { role: 'VIEW' },
    create: { whiteboardId: board.id, token: generateShareToken(), role: 'VIEW' },
  });

  await upsertReferenceOptions();
  await upsertNotes(board.id);

  console.log('Seed complete:', {
    board: board.name,
    owner: owner.email,
    members: [editColleague.email, viewColleague.email],
    pendingInvite: 'lena.hofer@finlex.de',
    shareLinkToken: shareLink.token,
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
