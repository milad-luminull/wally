import { describe, expect, it } from 'vitest';
import {
  membershipStatusValues,
  noteColourValues,
  noteHistoryEventTypeValues,
  noteHorizonValues,
  notePriorityValues,
  noteStatusValues,
  referenceTypeValues,
  whiteboardRoleValues,
} from '@wally/shared';

/**
 * Asserts every Zod enum in @wally/shared's enums.ts has exactly the same value set as
 * the corresponding Prisma enum in prisma/schema.prisma. The Prisma arrays below are
 * hand-copied from the schema (Prisma doesn't expose enum metadata at runtime without a
 * live client call) — whoever edits one enum must edit both, and this test is the trip
 * wire that catches it if they forget.
 */

const PRISMA_NOTE_PRIORITY = ['HOCH', 'MITTEL', 'NIEDRIG'];
const PRISMA_NOTE_HORIZON = ['HEUTE', 'DIESE_WOCHE', 'SPAETER'];
const PRISMA_NOTE_COLOUR = ['WEISS', 'EIS', 'SAND', 'MINZE', 'HIMMEL'];
const PRISMA_NOTE_STATUS = ['OPEN', 'DONE'];
const PRISMA_REFERENCE_TYPE = ['KUNDE', 'VERTRAG', 'SCHADEN'];
const PRISMA_WHITEBOARD_ROLE = ['VIEW', 'EDIT'];
const PRISMA_MEMBERSHIP_STATUS = ['PENDING', 'ACTIVE'];
const PRISMA_NOTE_HISTORY_EVENT_TYPE = ['CREATED', 'MOVED'];

function sameValueSet(a: readonly string[], b: readonly string[]) {
  expect(new Set(a)).toEqual(new Set(b));
  expect(a.length).toBe(b.length);
}

describe('Zod/Prisma enum parity', () => {
  it('NotePriority', () => sameValueSet(notePriorityValues, PRISMA_NOTE_PRIORITY));
  it('NoteHorizon', () => sameValueSet(noteHorizonValues, PRISMA_NOTE_HORIZON));
  it('NoteColour (no apricot)', () => sameValueSet(noteColourValues, PRISMA_NOTE_COLOUR));
  it('NoteStatus', () => sameValueSet(noteStatusValues, PRISMA_NOTE_STATUS));
  it('ReferenceType', () => sameValueSet(referenceTypeValues, PRISMA_REFERENCE_TYPE));
  it('WhiteboardRole', () => sameValueSet(whiteboardRoleValues, PRISMA_WHITEBOARD_ROLE));
  it('MembershipStatus', () => sameValueSet(membershipStatusValues, PRISMA_MEMBERSHIP_STATUS));
  it('NoteHistoryEventType', () =>
    sameValueSet(noteHistoryEventTypeValues, PRISMA_NOTE_HISTORY_EVENT_TYPE));
});
