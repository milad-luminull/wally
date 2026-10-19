import { describe, expect, it } from 'vitest';
import type { NoteDto } from '@wally/shared';
import { EDIT_LOCKED, editAskAllowed, textChanged } from './editAsk';

const note = (over: Partial<NoteDto> = {}) =>
  ({
    id: 'n1',
    status: 'OPEN',
    createdBy: { id: 'me', email: 'me@example.com', displayName: 'Me' },
    ...over,
  }) as NoteDto;

describe('asking again after an edit', () => {
  it('locks the words the person just wrote, and the horizon', () => {
    expect(EDIT_LOCKED).toEqual(['title', 'description', 'horizon']);
  });

  it('asks only on the person’s own open note with the assistant on', () => {
    expect(editAskAllowed(note(), 'me', true)).toBe(true);
    expect(editAskAllowed(note(), 'me', false)).toBe(false);
    expect(editAskAllowed(note({ status: 'DONE' }), 'me', true)).toBe(false);
    expect(
      editAskAllowed(
        note({ createdBy: { id: 'x', email: 'x@e.com', displayName: 'X' } }),
        'me',
        true,
      ),
    ).toBe(false);
    expect(editAskAllowed(note({ createdBy: null }), 'me', true)).toBe(false);
    expect(editAskAllowed(note(), undefined, true)).toBe(false);
  });

  it('counts a change in either field, ignoring spaces around the words', () => {
    const before = { title: 'Call doctor', description: '' };
    expect(textChanged(before, { title: 'Call doctor ', description: ' ' })).toBe(false);
    expect(textChanged(before, { title: 'Call the doctor', description: '' })).toBe(true);
    expect(textChanged(before, { title: 'Call doctor', description: 'about the check' })).toBe(
      true,
    );
  });
});
