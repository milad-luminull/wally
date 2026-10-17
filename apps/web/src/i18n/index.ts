import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { defaultNS, resources } from './resources';
import { FALLBACK_LOCALE, SUPPORTED_LOCALES } from './locales';
import { detectInitialLocale } from './detect';

export const i18n = i18next.createInstance();

/**
 * Initialises the one i18next instance. Called from exactly two places: main.tsx with browser
 * detection, and src/test/setup.ts pinned to English (src/i18n/germanSurface.test.tsx renders
 * German).
 *
 * Explicit rather than init-on-import so neither entry point depends on module evaluation
 * order, and so the test suite's language is the one setup.ts pins, never whatever jsdom's
 * `navigator.language` happens to be.
 *
 * `initReactI18next` registers this as react-i18next's default instance, which is what lets a
 * bare `useTranslation()` resolve with no `I18nextProvider` in the tree — load-bearing for the
 * component tests, which render without a wrapper.
 */
export function initI18n(overrides: { lng?: string } = {}) {
  if (i18n.isInitialized) return i18n;

  void i18n.use(initReactI18next).init({
    resources,
    defaultNS,
    ns: [defaultNS],
    lng: overrides.lng ?? detectInitialLocale(),
    fallbackLng: FALLBACK_LOCALE,
    supportedLngs: [...SUPPORTED_LOCALES],
    // React escapes every interpolated value already. Leaving i18next's own escaping on turns
    // the "&" in a board called "Meier & Söhne" into a literal "&amp;" on screen.
    interpolation: { escapeValue: false },
    // No backend and no async plugin, so init completes synchronously and `t` is usable on
    // the next line — which is what lets main.tsx initialise before render and the test setup
    // initialise at module scope. (i18next v26 dropped `initImmediate`; bundled resources make
    // it unnecessary.)
    // Belt and braces: with bundled resources i18next never suspends, but there is no Suspense
    // boundary anywhere in App.tsx, so a thrown promise would blank the screen rather than
    // show a fallback.
    react: { useSuspense: false },
    returnNull: false,
  });

  return i18n;
}
