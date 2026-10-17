import { describe, expect, it } from 'vitest';
import { resolveChips } from './chips.js';

describe('resolveChips', () => {
  const visible = new Map([
    ['n1', 'Call Müller'],
    ['n2', 'Write the quote'],
  ]);
  it('replaces a valid marker with the title and lists the note once', () => {
    const out = resolveChips('Open: [note:n1] and [note:n2]. First [note:n1].', visible);
    expect(out.text).toBe('Open: Call Müller and Write the quote. First Call Müller.');
    expect(out.chips).toEqual([
      { id: 'n1', title: 'Call Müller' },
      { id: 'n2', title: 'Write the quote' },
    ]);
  });
  it('drops a marker the caller cannot see without leaving a trace', () => {
    const out = resolveChips('See [note:secret] and [note:n1].', visible);
    expect(out.text).toBe('See and Call Müller.');
    expect(out.chips).toEqual([{ id: 'n1', title: 'Call Müller' }]);
  });
  it('leaves text without markers unchanged', () => {
    expect(resolveChips('Nothing open.', visible)).toEqual({ text: 'Nothing open.', chips: [] });
  });
});
