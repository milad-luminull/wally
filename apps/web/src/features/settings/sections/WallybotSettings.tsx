import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Switch } from '@/components/ui/switch';
import { useWallybotPreferences } from '@/lib/preferences';
import { SettingsSection } from '../SettingsSection';
import { SettingRow } from '../SettingRow';

export function WallybotSettings() {
  const { t } = useTranslation();
  const id = useId();
  const hintId = useId();
  const [wallybot, setWallybot] = useWallybotPreferences();
  return (
    <SettingsSection id="wallybot">
      <SettingRow
        label={t('account.wallybot.alwaysAsk')}
        htmlFor={id}
        hint={t('settings.wallybot.hint')}
        hintId={hintId}
      >
        <Switch
          id={id}
          aria-describedby={hintId}
          checked={!wallybot.autoApply}
          onCheckedChange={(on) => setWallybot({ autoApply: !on })}
        />
      </SettingRow>
    </SettingsSection>
  );
}
