import { FALLBACK_LOCALE, normalizeLocale, type AppLocale } from './locales';
import { readStoredLocale } from './storage';

/**
 * The locale to start in, before we know who is signed in.
 *
 * Precedence is this device's stored choice, then the browser's own preference order, then
 * German. The signed-in user's profile outranks all of it, but that arrives asynchronously —
 * LanguageProvider applies it and mirrors it back to storage, so the second visit starts in
 * the right language with no flash.
 *
 * Deliberately not i18next-browser-languagedetector: that precedence is ours, and this is
 * twelve lines.
 */
export function detectInitialLocale(): AppLocale {
  const stored = readStoredLocale();
  if (stored) return stored;

  const preferences = window.navigator.languages ?? [window.navigator.language];
  for (const preference of preferences) {
    const match = normalizeLocale(preference);
    if (match) return match;
  }
  return FALLBACK_LOCALE;
}
