import { describe, expect, it } from 'vitest';
import { acceptIntake } from './intake.js';
import type { ModelIntakeItem } from './model/index.js';

const item = (over: Partial<ModelIntakeItem>): ModelIntakeItem => ({
  kind: 'note',
  text: '',
  noteId: '',
  question: '',
  options: [],
  ...over,
});
const board = new Map([['n1', 'Update the premium table']]);

describe('acceptIntake', () => {
  it('keeps notes in order', () => {
    expect(
      acceptIntake(
        [item({ text: 'Dentist Thursday 8am' }), item({ text: ' Ask Tom about the budget ' })],
        'dentist thu 8am, ask tom re budget',
        board,
      ),
    ).toEqual({
      items: [
        { kind: 'note', text: 'Dentist Thursday 8am' },
        { kind: 'note', text: 'Ask Tom about the budget' },
      ],
      truncated: false,
    });
  });

  it('a duplicate with an unknown id becomes a note', () => {
    expect(
      acceptIntake(
        [item({ kind: 'duplicate', text: 'update the table', noteId: 'nope' })],
        'x',
        board,
      )?.items,
    ).toEqual([{ kind: 'note', text: 'update the table' }]);
  });

  it("fills the duplicate's title from the board", () => {
    expect(
      acceptIntake(
        [item({ kind: 'duplicate', text: 'update the premium table', noteId: 'n1' })],
        'x',
        board,
      )?.items,
    ).toEqual([
      {
        kind: 'duplicate',
        text: 'update the premium table',
        note: { id: 'n1', title: 'Update the premium table' },
      },
    ]);
  });

  it('keeps the first ten notes and marks truncated', () => {
    const many = Array.from({ length: 12 }, (_, i) => item({ text: `Note ${i + 1}` }));
    const accepted = acceptIntake(many, 'x', board);
    expect(accepted?.items).toHaveLength(10);
    expect(accepted?.items[9]).toEqual({ kind: 'note', text: 'Note 10' });
    expect(accepted?.truncated).toBe(true);
  });

  it('keeps only the first item that is not a note', () => {
    expect(
      acceptIntake(
        [
          item({ kind: 'ask', text: 'What is due tomorrow?' }),
          item({ text: 'Dentist Friday' }),
          item({ kind: 'ask', text: 'Who is Tom?' }),
        ],
        'x',
        board,
      )?.items,
    ).toEqual([
      { kind: 'ask', text: 'What is due tomorrow?' },
      { kind: 'note', text: 'Dentist Friday' },
    ]);
  });

  it('a clarify with one option becomes an ask of the message', () => {
    expect(
      acceptIntake(
        [
          item({
            kind: 'clarify',
            question: 'Which one?',
            options: [{ label: 'New note', action: 'note', text: 'The thing for Andrea' }],
          }),
        ],
        'the thing for andrea',
        board,
      )?.items,
    ).toEqual([{ kind: 'ask', text: 'the thing for andrea' }]);
  });

  it('keeps a clarify with two valid options', () => {
    const options = [
      { label: 'The renewal call', action: 'ask' as const, text: 'What about the renewal call?' },
      { label: 'New note', action: 'note' as const, text: 'Note for Andrea' },
    ];
    expect(
      acceptIntake(
        [item({ kind: 'clarify', question: 'The renewal call, or a new note?', options })],
        'the thing for andrea',
        board,
      )?.items,
    ).toEqual([{ kind: 'clarify', question: 'The renewal call, or a new note?', options }]);
  });

  it('returns null for no valid items', () => {
    expect(acceptIntake([item({ text: '   ' })], 'x', board)).toBeNull();
    expect(acceptIntake([], 'x', board)).toBeNull();
  });
});
