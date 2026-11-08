import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SETTINGS_SECTIONS } from './sections';
import { useSettingsNavigation } from './useSettingsNavigation';

/** The settings menu on a narrow screen: each section with the line that explains it. */
export function SettingsList() {
  const { t } = useTranslation();
  const { openSection } = useSettingsNavigation();
  return (
    <div className="settings-list">
      {SETTINGS_SECTIONS.map(({ id, icon: Icon, labelKey, descriptionKey }) => (
        <button
          key={id}
          type="button"
          className="settings-list-item"
          onClick={() => openSection(id, { fromList: true })}
        >
          <Icon size={16} strokeWidth={1.8} aria-hidden />
          <span className="settings-list-item-text">
            <span className="settings-list-item-label">{t(labelKey)}</span>
            <span className="settings-list-item-description">{t(descriptionKey)}</span>
          </span>
          <ChevronRight size={16} strokeWidth={1.8} aria-hidden />
        </button>
      ))}
    </div>
  );
}
