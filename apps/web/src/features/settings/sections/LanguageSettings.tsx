import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSelect } from '../LanguageSelect';
import { useLanguageStatus } from '../useLanguageStatus';
import { SettingsSection } from '../SettingsSection';
import { SettingRow } from '../SettingRow';

export function LanguageSettings() {
  const { t } = useTranslation();
  const id = useId();
  const status = useLanguageStatus();
  return (
    <SettingsSection id="language">
      {/* The status sits under the label, so the select stays centred in its row. */}
      <SettingRow label={t('account.language.label')} htmlFor={id} status={status}>
        <LanguageSelect id={id} className="setting-control-select" withStatus={false} />
      </SettingRow>
    </SettingsSection>
  );
}
