import { ChevronLeft } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { SETTINGS_SECTIONS, type SettingsSectionId } from './sections';
import { SettingsUserCard } from './SettingsUserCard';
import { SettingsSignOut } from './SettingsSignOut';
import { useSettingsNavigation } from './useSettingsNavigation';

/** The board rail's look, holding the settings menu (the settings design, "Layout"). */
export function SettingsRail({ current }: { current: SettingsSectionId }) {
  const { t } = useTranslation();
  const { origin, goBack } = useSettingsNavigation();
  return (
    <aside className="board-rail settings-rail">
      <div className="settings-rail-header">
        <button type="button" className="settings-rail-back" onClick={goBack}>
          <ChevronLeft size={15} strokeWidth={1.8} aria-hidden />
          <span>{t('settings.back')}</span>
        </button>
        {/* Not a heading: the section owns the page's h1, and the nav is named below. */}
        <p className="settings-rail-title">{t('settings.title')}</p>
      </div>
      <nav aria-label={t('settings.title')} className="board-rail-nav">
        {SETTINGS_SECTIONS.map(({ id, icon: Icon, labelKey }) => (
          <Link
            key={id}
            to={`/settings/${id}`}
            replace
            state={{ from: origin }}
            aria-current={id === current ? 'page' : undefined}
          >
            <Icon size={15} strokeWidth={1.8} aria-hidden />
            <span>{t(labelKey)}</span>
          </Link>
        ))}
      </nav>
      <div className="board-rail-bottom">
        <SettingsUserCard />
        <SettingsSignOut />
      </div>
    </aside>
  );
}
