import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { SETTINGS_SECTIONS, type SettingsSectionId } from './sections';

/** A settings page: its title, the one line that says what it is for, then its rows. */
export function SettingsSection({ id, children }: { id: SettingsSectionId; children: ReactNode }) {
  const { t } = useTranslation();
  const titleId = useId();
  const meta = SETTINGS_SECTIONS.find((s) => s.id === id)!;
  return (
    <section className="settings-section" aria-labelledby={titleId}>
      <h1 id={titleId} className="settings-title" tabIndex={-1}>
        {t(meta.labelKey)}
      </h1>
      <p className="settings-description">{t(meta.descriptionKey)}</p>
      <div className="settings-rows">{children}</div>
    </section>
  );
}

/** A heading inside a section, only where it has more than one group of rows. */
export function SettingsGroupTitle({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h2 id={id} className="settings-group-title">
      {children}
    </h2>
  );
}
