import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/i18n/languageContext';

/** What the language switch is doing: saving, failed (rolled back), or nothing to say. */
export function useLanguageStatus() {
  const { t } = useTranslation();
  const { isSaving, saveFailed } = useLanguage();
  return saveFailed
    ? t('account.language.saveFailed')
    : isSaving
      ? t('account.language.saving')
      : '';
}
