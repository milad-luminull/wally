import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { themePreferenceValues, type ThemePreference, type Palette } from '@wally/shared';
import { parsePalette } from './palettes';
import { useMe } from '@/i18n/useProfileLanguage';
import { useSavePreferences } from './preferences';

/** Read by the inline script in index.html too — keep the two in step. */
export const THEME_STORAGE_KEY = 'wally.theme';
export const PALETTE_STORAGE_KEY = 'wally.palette';

/** The wall colour per theme, for the browser chrome. Mirrors --canvas in globals.css. */
const THEME_COLOR = { light: '#f6f6f7', dark: '#0a0a0b' } as const;

type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
  theme: ThemePreference;
  palette: Palette;
  setPalette: (palette: Palette) => void;
  resolved: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
}

/* Outside a provider (isolated component tests) the theme is simply "system" and inert. */
const ThemeContext = createContext<ThemeContextValue>({
  theme: 'system',
  palette: 'paper',
  setPalette: () => {},
  resolved: 'light',
  setTheme: () => {},
});

/* Both accessors swallow errors: localStorage throws in Safari's private mode and when site
 * data is blocked, and a theme is never worth taking the app down for. */
function readStoredTheme(): ThemePreference {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return (themePreferenceValues as readonly string[]).includes(value ?? '')
      ? (value as ThemePreference)
      : 'system';
  } catch {
    return 'system';
  }
}

function writeStoredTheme(theme: ThemePreference) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Ignored — see above.
  }
}

const darkQuery = () => window.matchMedia?.('(prefers-color-scheme: dark)');

function applyTheme(resolved: ResolvedTheme, palette: Palette) {
  const root = document.documentElement;
  root.dataset.palette = palette;
  // Suppress transitions for one frame so the whole UI flips at once instead of smearing.
  root.classList.add('theme-switching');
  root.classList.toggle('dark', resolved === 'dark');
  root.classList.toggle('light', resolved === 'light');
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute(
      'content',
      getComputedStyle(root).getPropertyValue('--canvas').trim() || THEME_COLOR[resolved],
    );
  requestAnimationFrame(() => root.classList.remove('theme-switching'));
}

/**
 * Owns light/dark. The choice lives on the profile so it follows the user across devices,
 * and is mirrored to localStorage so index.html can apply it before first paint. `system`
 * tracks the OS live.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [palette, setPaletteState] = useState<Palette>(() => {
    try {
      return parsePalette(localStorage.getItem(PALETTE_STORAGE_KEY));
    } catch {
      return 'paper';
    }
  });
  const [theme, setThemeState] = useState<ThemePreference>(readStoredTheme);
  const [systemDark, setSystemDark] = useState(() => darkQuery()?.matches ?? false);
  const me = useMe();
  const profilePalette = me.data?.preferences.palette;
  const profileId = me.data?.id;
  const profileTheme = me.data?.preferences.theme;
  const signedIn = me.data !== undefined;
  const savePreferences = useSavePreferences();

  // The profile is the source of truth once it lands — another device may have changed it.
  useEffect(() => {
    if (profileTheme && profileTheme !== theme) {
      setThemeState(profileTheme);
      writeStoredTheme(profileTheme);
    }
    // Only react to the profile changing, not to local picks (those save to it anyway).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileTheme, profileId]);

  useEffect(() => {
    if (profilePalette) {
      setPaletteState(profilePalette);
      try {
        localStorage.setItem(PALETTE_STORAGE_KEY, profilePalette);
      } catch {
        /* Storage may be blocked. */
      }
    }
  }, [profilePalette, profileId]);

  useEffect(() => {
    const query = darkQuery();
    if (!query) return;
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const resolved: ResolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  useEffect(() => applyTheme(resolved, palette), [resolved, palette]);

  const setTheme = useCallback(
    (next: ThemePreference) => {
      setThemeState(next);
      writeStoredTheme(next);
      if (signedIn) savePreferences({ theme: next });
    },
    [savePreferences, signedIn],
  );

  const setPalette = useCallback(
    (next: Palette) => {
      setPaletteState(next);
      try {
        localStorage.setItem(PALETTE_STORAGE_KEY, next);
      } catch {
        /* Storage may be blocked. */
      }
      if (signedIn) savePreferences({ palette: next });
    },
    [savePreferences, signedIn],
  );
  const value = useMemo(
    () => ({ theme, resolved, setTheme, palette, setPalette }),
    [theme, resolved, setTheme, palette, setPalette],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
