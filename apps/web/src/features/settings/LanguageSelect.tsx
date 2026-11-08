import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLanguage } from '@/i18n/languageContext';
import { LANGUAGE_ENDONYMS, SUPPORTED_LOCALES, type AppLocale } from '@/i18n/locales';
import { useLanguageStatus } from './useLanguageStatus';

/**
 * The language picker. With `withStatus`, the status line that confirms or rolls back the
 * switch sits under it; without, the caller shows `useLanguageStatus()` elsewhere.
 */
export function LanguageSelect({
  id,
  className,
  withStatus = true,
}: {
  id: string;
  className?: string;
  withStatus?: boolean;
}) {
  const { language, setLanguage } = useLanguage();
  const status = useLanguageStatus();
  return (
    <div className={withStatus ? 'flex flex-col gap-1.5' : 'contents'}>
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
      {withStatus && (
        <p role="status" className="min-h-[1rem] text-12 text-fg-3">
          {status}
        </p>
      )}
    </div>
  );
}
