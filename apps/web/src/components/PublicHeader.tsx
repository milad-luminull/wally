import { Link } from 'react-router';
import { Palette } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/i18n/LanguageProvider';
import type { AppLocale } from '@/i18n/locales';
import { AppearanceControls } from './AppearanceControls';
import { BrandMark } from './BrandMark';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

export function PublicHeader({ showAuth = false }: { showAuth?: boolean }) {
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguage();
  return (
    <header className="public-header">
      <Link to="/" className="public-brand" aria-label={t('welcome.brand')}>
        <BrandMark size={27} />
        <span>
          {t('welcome.brand')}
          <small>{t('welcome.byline')}</small>
        </span>
      </Link>
      <nav className="public-actions" aria-label={t('welcome.navigation')}>
        <Popover>
          <PopoverTrigger className="public-appearance" aria-label={t('appearance.menu')}>
            <Palette size={18} />
          </PopoverTrigger>
          <PopoverContent align="end" className="z-overlay w-72 space-y-4 p-4">
            <AppearanceControls />
            <label className="flex flex-col gap-1.5 text-12 text-fg-3">
              {t('account.language.label')}
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as AppLocale)}
                className="h-9 rounded-md border border-input bg-surface px-2 text-13 text-fg-1"
              >
                <option value="en" lang="en">
                  {'English'}
                </option>
                <option value="de" lang="de">
                  {'Deutsch'}
                </option>
              </select>
            </label>
          </PopoverContent>
        </Popover>
        {showAuth && (
          <>
            <Link to="/login" className="public-login">
              {t('welcome.login')}
            </Link>
            <Link to="/signup" className="public-signup">
              {t('welcome.signup')}
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
