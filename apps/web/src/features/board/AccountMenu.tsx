import { LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/features/auth/AuthProvider';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLanguage } from '@/i18n/LanguageProvider';
import { SUPPORTED_LOCALES, type AppLocale } from '@/i18n/locales';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { initialsOf } from './util/noteDerived';

/**
 * The account affordance the chrome was missing: `AuthProvider` has exposed `signOut`
 * since the first build, but nothing in the UI ever called it, so a signed-in user had no
 * way out of the app.
 */
/**
 * Endonyms — each language named in itself — and never translated: someone who lands in a
 * language they cannot read has to be able to find their own in this list.
 */
const LANGUAGE_ENDONYMS: Record<AppLocale, string> = {
  de: 'Deutsch',
  en: 'English',
};

export function AccountMenu() {
  const { t } = useTranslation();
  const { user, signOut } = useAuth();
  const { language, setLanguage, isSaving, saveFailed } = useLanguage();
  if (!user) return null;

  const name = user.displayName ?? user.email ?? t('account.menuAria');

  return (
    <Popover>
      <PopoverTrigger
        aria-label={t('account.menuAria')}
        /* The avatar stays 32px; the trigger around it grows to 44 on touch. */
        className="flex items-center justify-center rounded-full transition-transform duration-150 ease-ds hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-alt motion-reduce:hover:translate-y-0 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
      >
        <Avatar className="h-8 w-8 ring-2 ring-border-subtle">
          <AvatarFallback className="bg-[color:var(--petrol-dark)] text-11">
            {initialsOf(name)}
          </AvatarFallback>
        </Avatar>
      </PopoverTrigger>

      <PopoverContent className="w-64 p-0">
        <div className="flex flex-col gap-0.5 border-b border-border-subtle px-4 py-3">
          {user.displayName && (
            <p className="truncate text-13 font-semibold text-fg-1">{user.displayName}</p>
          )}
          <p className="truncate text-12 text-fg-muted">{user.email}</p>
        </div>
        <div className="flex flex-col gap-1.5 border-b border-border-subtle px-3 py-3">
          <Label htmlFor="account-language" className="text-11 font-medium text-fg-muted">
            {t('account.language.label')}
          </Label>
          <Select value={language} onValueChange={(next) => setLanguage(next as AppLocale)}>
            <SelectTrigger
              id="account-language"
              className="h-9 rounded-md border border-border bg-card px-3 text-13 [@media(pointer:coarse)]:h-11"
            >
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
          <p role="status" className="min-h-[1rem] text-11 text-fg-muted">
            {saveFailed
              ? t('account.language.saveFailed')
              : isSaving
                ? t('account.language.saving')
                : ''}
          </p>
        </div>

        <div className="p-1.5">
          <button
            type="button"
            onClick={() => void signOut()}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-13 font-medium text-fg-2 transition-colors duration-150 hover:bg-inset hover:text-fg-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)]"
          >
            <LogOut className="h-4 w-4 text-fg-muted" strokeWidth={1.9} />
            {t('account.signOut')}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
