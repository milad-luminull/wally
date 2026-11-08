import { describe, expect, it } from 'vitest';
import { readSettingsOrigin, settingsLinkState } from './origin';

describe('settingsLinkState', () => {
  it('keeps the whole place: path, query and hash', () => {
    expect(
      settingsLinkState({ pathname: '/boards/b1', search: '?view=list', hash: '#n1' }),
    ).toEqual({
      from: '/boards/b1?view=list#n1',
    });
  });
});

describe('readSettingsOrigin', () => {
  it('returns the page Settings was opened from', () => {
    expect(readSettingsOrigin({ from: '/boards/b1?view=list#n1' })).toBe('/boards/b1?view=list#n1');
  });

  it.each([
    undefined,
    null,
    42,
    {},
    { from: 7 },
    { from: '//evil.com' },
    { from: 'https://evil.com' },
    { from: '/settings/language' },
    { from: '/settings' },
    { from: '/\\evil.com' },
    { from: '/\t/evil.com' },
    { from: '/settings#x' },
    { from: '/SETTINGS' },
    { from: '/Settings/language' },
  ])('falls back to the board home for %j', (state) => {
    expect(readSettingsOrigin(state)).toBe('/boards');
  });
});
