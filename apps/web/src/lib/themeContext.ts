import { createContext, useContext } from 'react';
import type { Palette, ThemePreference } from '@wally/shared';

export type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
  theme: ThemePreference;
  palette: Palette;
  setPalette: (palette: Palette) => void;
  resolved: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
}

/* Outside a provider (isolated component tests) the theme is simply "system" and inert. */
export const ThemeContext = createContext<ThemeContextValue>({
  theme: 'system',
  palette: 'paper',
  setPalette: () => {},
  resolved: 'light',
  setTheme: () => {},
});

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
