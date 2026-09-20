import { describe, expect, it } from 'vitest';
import { languageFromAcceptLanguage } from './language.js';

describe('languageFromAcceptLanguage', () => {
  it.each([
    // No header at all, and the degenerate empty one.
    [undefined, 'de'],
    ['', 'de'],
    // Region subtags and casing are noise.
    ['de', 'de'],
    ['de-DE', 'de'],
    ['DE-de', 'de'],
    ['de-AT', 'de'],
    ['en', 'en'],
    ['en-US', 'en'],
    ['en-GB', 'en'],
    // The header Chrome actually sends.
    ['en-US,en;q=0.9,de;q=0.8', 'en'],
    // q ordering beats header order...
    ['de;q=0.8,en;q=0.9', 'en'],
    // ...but equal (implicit) q falls back to header order, via a stable sort.
    ['de,en', 'de'],
    // q=0 means "not acceptable", so this is really a header asking for anything but English.
    ['en;q=0', 'de'],
    // Unknown, wildcard and malformed input all land on the default.
    ['fr-FR', 'de'],
    ['*', 'de'],
    ['!!!', 'de'],
    // An unsupported tag must not stop the scan.
    ['xx,en', 'en'],
  ])('resolves %o to %s', (header, expected) => {
    expect(languageFromAcceptLanguage(header)).toBe(expected);
  });
});
