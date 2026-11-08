import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Label } from './ui/label';
import { PaletteSelect } from './PaletteSelect';
import { ThemeModeControl } from './ThemeModeControl';

/** Palette and mode together, for the signed-out landing page's appearance menu. */
export function AppearanceControls() {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id} className="text-12 font-medium text-fg-3">
          {t('appearance.palette')}
        </Label>
        <PaletteSelect id={id} />
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-12 font-medium text-fg-3">{t('account.theme.label')}</p>
        <ThemeModeControl className="grid w-full grid-cols-3 [&>button]:justify-center" />
      </div>
    </div>
  );
}
