import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmailVerificationBanner } from '@/features/auth/EmailVerificationBanner';
import { useBreakpoint } from '@/lib/useBreakpoint';
import type { SettingsSectionId } from './sections';
import { SettingsRail } from './SettingsRail';
import { SettingsList } from './SettingsList';
import { SettingsUserCard } from './SettingsUserCard';
import { SettingsSignOut } from './SettingsSignOut';
import { useSettingsNavigation } from './useSettingsNavigation';

/**
 * The frame around every settings page. At 1080px and up, the board rail's look on the left
 * and the section on the right; below that, the list, then a section full width.
 */
export function SettingsShell({
  section,
  children,
}: {
  section: SettingsSectionId | undefined;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const { isDesktop } = useBreakpoint();
  const { goBack, backToList } = useSettingsNavigation();

  return (
    <div className="settings-shell">
      <EmailVerificationBanner />
      {isDesktop && section ? (
        <div className="board-layout">
          <SettingsRail current={section} />
          <main className="settings-content wally-scroll">{children}</main>
        </div>
      ) : (
        <main className="settings-mobile wally-scroll">
          {section ? (
            <>
              <button
                type="button"
                className="settings-mobile-back"
                aria-label={t('settings.backToList')}
                onClick={backToList}
              >
                <ChevronLeft size={15} strokeWidth={1.8} aria-hidden />
                <span>{t('settings.title')}</span>
              </button>
              <div className="mt-4">{children}</div>
            </>
          ) : (
            <>
              <button type="button" className="settings-mobile-back" onClick={goBack}>
                <ChevronLeft size={15} strokeWidth={1.8} aria-hidden />
                <span>{t('settings.back')}</span>
              </button>
              <h1 className="settings-title">{t('settings.title')}</h1>
              <SettingsList />
              <div className="settings-mobile-footer">
                <SettingsUserCard />
                <SettingsSignOut />
              </div>
            </>
          )}
        </main>
      )}
    </div>
  );
}
