import { useId } from 'react';
import { Grid3x3, Grip, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PaletteSelect } from '@/components/PaletteSelect';
import { ThemeModeControl } from '@/components/ThemeModeControl';
import { Segmented } from '@/components/ui/segmented';
import { useCanvasPattern } from '@/lib/preferences';
import { SettingsSection } from '../SettingsSection';
import { SettingRow } from '../SettingRow';

export function AppearanceSettings() {
  const { t } = useTranslation();
  const paletteId = useId();
  const modeHintId = useId();
  const [canvasPattern, setCanvasPattern] = useCanvasPattern();
  return (
    <SettingsSection id="appearance">
      <SettingRow label={t('appearance.palette')} htmlFor={paletteId}>
        <PaletteSelect id={paletteId} className="setting-control-select" />
      </SettingRow>
      <SettingRow
        label={t('settings.appearance.mode')}
        hint={t('settings.appearance.modeHint')}
        hintId={modeHintId}
      >
        <div aria-describedby={modeHintId}>
          <ThemeModeControl label={t('settings.appearance.mode')} />
        </div>
      </SettingRow>
      <SettingRow label={t('account.canvas.label')}>
        <Segmented
          aria-label={t('account.canvas.label')}
          value={canvasPattern}
          onChange={setCanvasPattern}
          options={[
            {
              value: 'dots',
              label: t('account.canvas.dots'),
              icon: <Grip strokeWidth={1.75} aria-hidden />,
            },
            {
              value: 'grid',
              label: t('account.canvas.grid'),
              icon: <Grid3x3 strokeWidth={1.75} aria-hidden />,
            },
            {
              value: 'none',
              label: t('account.canvas.none'),
              icon: <Square strokeWidth={1.75} aria-hidden />,
            },
          ]}
        />
      </SettingRow>
    </SettingsSection>
  );
}
