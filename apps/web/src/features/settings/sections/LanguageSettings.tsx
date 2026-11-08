import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSelect } from '../LanguageSelect';
import { SettingsSection } from '../SettingsSection';
import { SettingRow } from '../SettingRow';

export function LanguageSettings() {
  const { t } = useTranslation();
  const id = useId();
  return (
    <SettingsSection id="language">
      <SettingRow label={t('account.language.label')} htmlFor={id}>
        <LanguageSelect id={id} className="setting-control-select" />
      </SettingRow>
    </SettingsSection>
  );
}
