import { DEFAULT_LANGUAGE, languageValues, type Language } from '@wally/shared';

/**
 * The UI locales, re-exported from the shared contract under UI-facing names. `Language` is
 * what the API stores and validates; `AppLocale` is the same set seen from the browser, where
 * it also ends up in `<html lang>`, `Intl` and `Accept-Language`.
 */
export type AppLocale = Language;

export const SUPPORTED_LOCALES = languageValues;
export const FALLBACK_LOCALE: AppLocale = DEFAULT_LANGUAGE;

/**
 * Narrows anything locale-shaped to a locale we actually ship, or null.
 *
 * Region subtags are dropped: 'de-AT' and 'de-CH' are German as far as this app is concerned,
 * and `navigator.language` almost always carries one.
 */
export function normalizeLocale(raw: string | null | undefined): AppLocale | null {
  if (!raw) return null;
  const primary = raw.toLowerCase().split('-')[0];
  return SUPPORTED_LOCALES.find((locale) => locale === primary) ?? null;
}
