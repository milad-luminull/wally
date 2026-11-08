import type { IntakeItem, IntakeResponse } from '@wally/shared';

/**
 * Sample messages for scoring the intake call (`intake-eval.ts`): what a person typed into the
 * Wally box, the open notes on their board, and the kinds a person would expect back, in order.
 * Half English, half German, because people write both. Today is Sunday 2026-11-08.
 */
export interface IntakeFixture {
  id: string;
  message: string;
  board?: { id: string; title: string }[];
  context?: { question: string; answer: string };
  expect: IntakeItem['kind'][];
  /** For an expected duplicate: the note it must name. */
  duplicateOf?: string;
}

const board = [
  { id: 'n1', title: 'Update premium table to v2' },
  { id: 'n2', title: 'Call Andrea about the Munich renewal' },
  { id: 'n3', title: 'Prepare board slides' },
  { id: 'n4', title: 'Angebot an Irem schicken' },
];

export const INTAKE_FIXTURES: IntakeFixture[] = [
  { id: 'en-one-note', message: 'call irem wed about deductibles', expect: ['note'] },
  {
    id: 'en-two-notes-one-sentence',
    message: 'dentist thu 8am, ask tom re budget',
    expect: ['note', 'note'],
  },
  {
    id: 'en-three-lines',
    message: 'book flights to lisbon\nrenew car insurance\nbuy a gift for mia',
    expect: ['note', 'note', 'note'],
  },
  {
    id: 'en-question-no-mark',
    message: "what's blocking the munich renewal",
    board,
    expect: ['ask'],
  },
  {
    id: 'en-question-mark',
    message: 'Who is working on the board slides?',
    board,
    expect: ['ask'],
  },
  { id: 'en-due-friday', message: "what's due friday", board, expect: ['ask'] },
  { id: 'en-imperative-lookup', message: "show me what's overdue", board, expect: ['ask'] },
  { id: 'en-note-with-mark', message: 'ask tom re budget?', expect: ['note'] },
  {
    id: 'en-duplicate',
    message: 'update the premium table',
    board,
    expect: ['duplicate'],
    duplicateOf: 'n1',
  },
  { id: 'en-vague', message: 'the thing for andrea', board, expect: ['clarify'] },
  {
    id: 'en-note-and-question',
    message: "add dentist friday, and what's due tomorrow?",
    board,
    expect: ['note', 'ask'],
  },
  {
    id: 'en-follow-up',
    message: 'and next week?',
    board,
    context: {
      question: "What's due this week?",
      answer: 'Call Andrea about the Munich renewal is due Tuesday.',
    },
    expect: ['ask'],
  },
  { id: 'de-one-note', message: 'irem mittwoch wegen selbstbehalt anrufen', expect: ['note'] },
  {
    id: 'de-two-notes',
    message: 'zahnarzt donnerstag 8 uhr und tom wegen budget fragen',
    expect: ['note', 'note'],
  },
  {
    id: 'de-three-lines',
    message: 'flüge nach lissabon buchen\nkfz-versicherung verlängern\ngeschenk für mia',
    expect: ['note', 'note', 'note'],
  },
  {
    id: 'de-question-no-mark',
    message: 'was blockiert die verlängerung in münchen',
    board,
    expect: ['ask'],
  },
  { id: 'de-question-mark', message: 'Wer arbeitet an den Folien?', board, expect: ['ask'] },
  { id: 'de-due-friday', message: 'was ist freitag fällig', board, expect: ['ask'] },
  { id: 'de-imperative-lookup', message: 'zeig mir alles überfällige', board, expect: ['ask'] },
  { id: 'de-note-with-mark', message: 'tom fragen ob das budget reicht?', expect: ['note'] },
  {
    id: 'de-duplicate',
    message: 'irem das angebot schicken',
    board,
    expect: ['duplicate'],
    duplicateOf: 'n4',
  },
  { id: 'de-vague', message: 'das ding für andrea', board, expect: ['clarify'] },
  {
    id: 'de-note-and-question',
    message: 'zahnarzt freitag eintragen, und was ist morgen fällig?',
    board,
    expect: ['note', 'ask'],
  },
  {
    id: 'de-follow-up',
    message: 'und nächste woche?',
    board,
    context: {
      question: 'Was ist diese Woche fällig?',
      answer: 'Call Andrea about the Munich renewal ist am Dienstag fällig.',
    },
    expect: ['ask'],
  },
];

/** Right when the kinds match in order and an expected duplicate names its note. */
export function scoreIntakeFixture(fixture: IntakeFixture, answer: IntakeResponse | null): boolean {
  if (!answer) return false;
  const kinds = answer.items.map((item) => item.kind);
  if (kinds.length !== fixture.expect.length) return false;
  if (kinds.some((kind, i) => kind !== fixture.expect[i])) return false;
  if (fixture.duplicateOf)
    return answer.items.some(
      (item) => item.kind === 'duplicate' && item.note.id === fixture.duplicateOf,
    );
  return true;
}
