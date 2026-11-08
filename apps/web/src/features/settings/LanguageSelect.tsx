import { useTranslation } from 'react-i18next';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLanguage } from '@/i18n/languageContext';
import { LANGUAGE_ENDONYMS, SUPPORTED_LOCALES, type AppLocale } from '@/i18n/locales';

/** The language picker and the status line that confirms or rolls back the switch. */
export function LanguageSelect({ id, className }: { id: string; className?: string }) {
  const { t } = useTranslation();
  const { language, setLanguage, isSaving, saveFailed } = useLanguage();
  return (
    <div className="flex flex-col gap-1.5">
      <Select value={language} onValueChange={(next) => setLanguage(next as AppLocale)}>
        <SelectTrigger id={id} className={className}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SUPPORTED_LOCALES.map((locale) => (
            /* lang= switches the screen reader's voice for that one option (WCAG 3.1.2). */
            <SelectItem key={locale} value={locale} lang={locale}>
              {LANGUAGE_ENDONYMS[locale]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {/* The whole UI changing language is silent otherwise. This confirms the switch to a
          screen-reader user, and carries the rollback message when the save fails. */}
      <p role="status" className="min-h-[1rem] text-12 text-fg-3">
        {saveFailed ? t('account.language.saveFailed') : isSaving ? t('account.language.saving') : ''}
      </p>
    </div>
  );
}
