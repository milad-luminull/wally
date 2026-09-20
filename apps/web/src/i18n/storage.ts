import { normalizeLocale, type AppLocale } from './locales';

const STORAGE_KEY = 'wally.language';

/**
 * The locale this device last used.
 *
 * Both accessors swallow their errors: `localStorage` throws outright in Safari's private
 * mode and when site data is blocked, and a language preference is never worth taking the app
 * down for. A miss just falls through to browser detection.
 */
export function readStoredLocale(): AppLocale | null {
  try {
    return normalizeLocale(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeStoredLocale(locale: AppLocale): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Ignored — see above.
  }
}
