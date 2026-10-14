import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES, type BoardPreferences } from '@wally/shared';
import { applyPreferencesUpdate } from './preferences';

describe('applyPreferencesUpdate', () => {
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
});
