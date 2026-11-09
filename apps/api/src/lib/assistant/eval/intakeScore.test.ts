import { describe, expect, it } from 'vitest';
import { scoreIntakeFixture, type IntakeFixture } from './intakeFixtures.js';

const fixture: IntakeFixture = {
  id: 'note-and-question',
  message: 'dentist friday, and what is due tomorrow',
  expect: ['note', 'ask'],
};

describe('scoreIntakeFixture', () => {
  it('is right when the kinds match in order', () => {
    expect(
      scoreIntakeFixture(fixture, {
        items: [
          { kind: 'note', text: 'Dentist Friday' },
          { kind: 'ask', text: 'What is due tomorrow?' },
        ],
        truncated: false,
      }),
    ).toBe(true);
  });

  it('is wrong for another order, another kind or no answer', () => {
    expect(
      scoreIntakeFixture(fixture, {
        items: [
          { kind: 'ask', text: 'What is due tomorrow?' },
          { kind: 'note', text: 'Dentist Friday' },
        ],
        truncated: false,
      }),
    ).toBe(false);
    expect(
      scoreIntakeFixture(fixture, {
        items: [{ kind: 'note', text: 'dentist friday, and what is due tomorrow' }],
        truncated: false,
      }),
    ).toBe(false);
    expect(scoreIntakeFixture(fixture, null)).toBe(false);
  });

  it('a duplicate must name the expected note', () => {
    const dupe: IntakeFixture = {
      id: 'dupe',
      message: 'update the premium table',
      board: [{ id: 'n1', title: 'Update premium table to v2' }],
      expect: ['duplicate'],
      duplicateOf: 'n1',
    };
    const answer = (id: string) => ({
      items: [{ kind: 'duplicate' as const, text: 'x', note: { id, title: 'x' } }],
      truncated: false,
    });
    expect(scoreIntakeFixture(dupe, answer('n1'))).toBe(true);
    expect(scoreIntakeFixture(dupe, answer('n2'))).toBe(false);
  });
});
