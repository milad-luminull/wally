import { describe, expect, it } from 'vitest';
import { NOTE_TITLE_MAX_LENGTH } from '@wally/shared';
import { noteDraftOf } from './noteDraft';

describe('noteDraftOf', () => {
  it('one line is the title', () => {
    expect(noteDraftOf('  Call Irem on Wednesday  ')).toEqual({
      title: 'Call Irem on Wednesday',
      description: '',
    });
  });

  it('further lines are the description', () => {
    expect(noteDraftOf('Prepare board slides\n\nrevenue chart\nhiring plan')).toEqual({
      title: 'Prepare board slides',
      description: 'revenue chart\nhiring plan',
    });
  });

  it('a first line over the title limit is cut at a word, the whole text kept as description', () => {
    const long = `${'word '.repeat(52)}end`;
    const draft = noteDraftOf(long);
    expect(draft.title.length).toBeLessThanOrEqual(NOTE_TITLE_MAX_LENGTH);
    expect(draft.title.endsWith('word')).toBe(true);
    expect(draft.title.endsWith(' ')).toBe(false);
    expect(draft.description).toBe(long);
  });
});
