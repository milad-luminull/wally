import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { themePreferenceValues, type ThemePreference } from '@wally/shared';
import { useMe } from '@/i18n/useProfileLanguage';
import { useSavePreferences } from './preferences';

/** Read by the inline script in index.html too — keep the two in step. */
export const THEME_STORAGE_KEY = 'wally.theme';

/** The wall colour per theme, for the browser chrome. Mirrors --canvas in globals.css. */
const THEME_COLOR = { light: '#f6f6f7', dark: '#0a0a0b' } as const;

type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
  theme: ThemePreference;
  resolved: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

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

function applyTheme(resolved: ResolvedTheme) {
  const root = document.documentElement;
  if (root.classList.contains(resolved === 'dark' ? 'dark' : 'light')) return;
  // Suppress transitions for one frame so the whole UI flips at once instead of smearing.
  root.classList.add('theme-switching');
  root.classList.toggle('dark', resolved === 'dark');
  root.classList.toggle('light', resolved === 'light');
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_COLOR[resolved]);
  requestAnimationFrame(() => root.classList.remove('theme-switching'));
}

/**
 * Owns light/dark. The choice lives on the profile so it follows the user across devices,
 * and is mirrored to localStorage so index.html can apply it before first paint. `system`
 * tracks the OS live.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(readStoredTheme);
  const [systemDark, setSystemDark] = useState(() => darkQuery()?.matches ?? false);
  const me = useMe();
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
  }, [profileTheme]);

  useEffect(() => {
    const query = darkQuery();
    if (!query) return;
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const resolved: ResolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  useEffect(() => applyTheme(resolved), [resolved]);

  const setTheme = useCallback(
    (next: ThemePreference) => {
      setThemeState(next);
      writeStoredTheme(next);
      if (signedIn) savePreferences({ theme: next });
    },
    [savePreferences, signedIn],
  );

  const value = useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside ThemeProvider');
  return context;
}
