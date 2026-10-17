import { describe, expect, it } from 'vitest';
import { resolveChips } from './chips.js';

describe('resolveChips', () => {
  const visible = new Map([
    ['n1', 'Müller anrufen'],
    ['n2', 'Angebot schreiben'],
  ]);
  it('replaces a valid marker with the title and lists the note once', () => {
    const out = resolveChips('Offen: [note:n1] und [note:n2]. Zuerst [note:n1].', visible);
    expect(out.text).toBe('Offen: Müller anrufen und Angebot schreiben. Zuerst Müller anrufen.');
    expect(out.chips).toEqual([
      { id: 'n1', title: 'Müller anrufen' },
      { id: 'n2', title: 'Angebot schreiben' },
    ]);
  });
  it('drops a marker the caller cannot see without leaving a trace', () => {
    const out = resolveChips('Siehe [note:secret] und [note:n1].', visible);
    expect(out.text).toBe('Siehe und Müller anrufen.');
    expect(out.chips).toEqual([{ id: 'n1', title: 'Müller anrufen' }]);
  });
  it('leaves text without markers unchanged', () => {
    expect(resolveChips('Nichts offen.', visible)).toEqual({ text: 'Nichts offen.', chips: [] });
  });
});
