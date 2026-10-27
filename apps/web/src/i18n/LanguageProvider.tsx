import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FALLBACK_LOCALE, normalizeLocale } from './locales';
import { LanguageContext, type LanguageContextValue } from './languageContext';
import { writeStoredLocale } from './storage';
import { useMe, useUpdateLanguage } from './useProfileLanguage';

/**
 * Keeps the active language, the signed-in profile and the document in step.
 *
 * Deliberately renders NO I18nextProvider: initReactI18next already registered the instance as
 * react-i18next's default, so `useTranslation()` resolves without one — and scoping the
 * instance to a provider would break the component tests, which render without this wrapper.
 * All this owns is the profile sync, <html lang>, the document title, and the selector's
 * context.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const me = useMe();
  const { setLanguage, isSaving, saveFailed } = useUpdateLanguage();

  const profileLanguage = normalizeLocale(me.data?.language);

  // The profile outranks detection, and is mirrored back to localStorage so the NEXT cold
  // start already opens in the right language — otherwise every visit would briefly paint in
  // the detected one before the /me response landed.
  useEffect(() => {
    if (!profileLanguage || profileLanguage === i18n.language) return;
    void i18n.changeLanguage(profileLanguage);
    writeStoredLocale(profileLanguage);
  }, [profileLanguage, i18n]);

  // Subscribed to languageChanged rather than set once on mount: the profile resolves late,
  // and without this the copy would switch while the tab title and <html lang> stayed behind.
  // <html lang> is what tells a screen reader which voice to use.
  useEffect(() => {
    function sync() {
      document.documentElement.lang = i18n.resolvedLanguage ?? FALLBACK_LOCALE;
      document.title = t('app.title');
    }
    sync();
    i18n.on('languageChanged', sync);
    return () => {
      i18n.off('languageChanged', sync);
    };
  }, [i18n, t]);

  const value: LanguageContextValue = {
    language: normalizeLocale(i18n.language) ?? FALLBACK_LOCALE,
    setLanguage,
    isSaving,
    saveFailed,
  };

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
