import { describe, expect, it } from 'vitest';
import { languageValues } from '@wally/shared';
import { displayTitle, untitledLabel } from './untitled.js';

describe('untitled', () => {
  it('has a label for every language', () => {
    for (const language of languageValues) expect(untitledLabel(language)).not.toBe('');
    expect(untitledLabel('de')).toBe('Ohne Titel');
    expect(untitledLabel('en')).toBe('Untitled');
  });
  it('shows the label for an empty or blank title', () => {
    expect(displayTitle('', 'de')).toBe('Ohne Titel');
    expect(displayTitle('  \t', 'en')).toBe('Untitled');
  });
  it('keeps a real title exactly as stored', () => {
    expect(displayTitle(' Call Müller ', 'en')).toBe(' Call Müller ');
  });
});
