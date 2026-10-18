import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { MeDto } from '@wally/shared';
import { DEFAULT_PREFERENCES } from '@wally/shared';
const state = vi.hoisted(() => ({ profile: undefined as MeDto | undefined, save: vi.fn() }));
vi.mock('@/i18n/useProfileLanguage', () => ({ useMe: () => ({ data: state.profile }) }));
vi.mock('./preferences', () => ({ useSavePreferences: () => state.save }));
import { ThemeProvider, useTheme } from './theme';
const wrapper = ({ children }: { children: ReactNode }) => (
  <ThemeProvider>{children}</ThemeProvider>
);
beforeEach(() => {
  localStorage.clear();
  state.profile = undefined;
  state.save.mockClear();
});
it('defaults an unknown palette to Paper Wall and keeps palette independent from appearance', () => {
  localStorage.setItem('wally.palette', 'unknown');
  const { result } = renderHook(useTheme, { wrapper });
  expect(result.current.palette).toBe('paper');
  act(() => result.current.setPalette('minimal'));
  act(() => result.current.setTheme('dark'));
  expect(result.current.palette).toBe('minimal');
  expect(document.documentElement.dataset.palette).toBe('minimal');
  expect(document.documentElement).toHaveClass('dark');
  expect(localStorage.getItem('wally.palette')).toBe('minimal');
  expect(state.save).not.toHaveBeenCalled();
});
it('saves signed-in palette changes and adopts the next account profile', () => {
  state.profile = {
    id: 'a',
    email: 'a@example.com',
    displayName: null,
    language: 'en',
    preferences: { ...DEFAULT_PREFERENCES, palette: 'aurora' },
  };
  const { result, rerender } = renderHook(useTheme, { wrapper });
  expect(result.current.palette).toBe('aurora');
  act(() => result.current.setPalette('sprout'));
  expect(state.save).toHaveBeenCalledWith({ palette: 'sprout' });
  state.profile = { ...state.profile, id: 'b' };
  rerender();
  expect(result.current.palette).toBe('aurora');
});
