import { afterEach, describe, expect, it } from 'vitest';
import { i18n } from './index';
import { parseIsoDate } from './dates';

/**
 * Guards the one piece of i18n machinery with no compile-time safety net: i18next's built-in
 * `datetime` formatter, which every date in the app now goes through. If its option syntax
 * ever stops parsing it fails silently, rendering the raw token instead of a date.
 */
describe('date formatting', () => {
  afterEach(async () => {
    await i18n.changeLanguage('de');
  });

  it('formats a due date day-first in German and month-first in English', async () => {
    const date = parseIsoDate('2026-09-18');

    expect(i18n.t('common.shortDate', { date })).toBe('18.09.');
    await i18n.changeLanguage('en');
    expect(i18n.t('common.shortDate', { date })).toBe('09/18');
  });

  it('parses a calendar date at local midnight, not UTC', () => {
    // `new Date('2026-09-18')` is UTC midnight, i.e. the 17th west of Greenwich.
    expect(parseIsoDate('2026-09-18').getDate()).toBe(18);
    expect(parseIsoDate('2026-09-18').getMonth()).toBe(8);
  });
});
