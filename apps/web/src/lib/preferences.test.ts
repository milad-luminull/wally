import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES, type BoardPreferences } from '@wally/shared';
import { applyPreferencesUpdate } from './preferences';

describe('applyPreferencesUpdate', () => {
  it('changes palette independently and preserves it through another preference update', () => {
    const current = { ...DEFAULT_PREFERENCES, theme: 'dark' as const };
    const next = applyPreferencesUpdate(current, { palette: 'minimal' });
    expect(next).toEqual({ ...current, palette: 'minimal' });
    expect(applyPreferencesUpdate(next, { canvas: 'grid' }).palette).toBe('minimal');
  });
  it('changes the canvas pattern and leaves everything else alone', () => {
    const current = { ...DEFAULT_PREFERENCES, theme: 'dark' as const };

    expect(applyPreferencesUpdate(current, { canvas: 'grid' })).toEqual({
      ...current,
      canvas: 'grid',
    });
  });

  it('forgets a board sent as null and keeps the others', () => {
    const board: BoardPreferences = {
      view: 'list',
      axis: 'free',
      done: true,
      mine: false,
      priority: [],
      visibility: 'all',
    };
    const current = { ...DEFAULT_PREFERENCES, boards: { a: board, b: board } };

    expect(applyPreferencesUpdate(current, { boards: { a: null } }).boards).toEqual({ b: board });
  });

  it('changes the Wallybot setting alone, and keeps it when an update leaves it out', () => {
    const current = { ...DEFAULT_PREFERENCES, theme: 'dark' as const };

    const askFirst = applyPreferencesUpdate(current, { wallybot: { autoApply: false } });
    expect(askFirst).toEqual({ ...current, wallybot: { autoApply: false } });
    expect(applyPreferencesUpdate(askFirst, { canvas: 'grid' }).wallybot).toEqual({
      autoApply: false,
    });
  });
});
