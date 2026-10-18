import { useId } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { paletteValues, type Palette } from '@wally/shared';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Segmented } from './ui/segmented';
import { useTheme } from '@/lib/theme';
import { PALETTES } from '@/lib/palettes';

export function AppearanceControls() {
  const { t } = useTranslation();
  const id = useId();
  const { palette, setPalette, theme, setTheme } = useTheme();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id} className="text-12 font-medium text-fg-3">
          {t('appearance.palette')}
        </Label>
        <Select value={palette} onValueChange={(value) => setPalette(value as Palette)}>
          <SelectTrigger id={id}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-overlay">
            {paletteValues.map((key) => (
              <SelectItem key={key} value={key}>
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden className="flex -space-x-1">
                    {PALETTES[key].swatches.map((colour) => (
                      <span
                        key={colour}
                        className="h-3 w-3 rounded-full border border-black/10"
                        style={{ backgroundColor: colour }}
                      />
                    ))}
                  </span>
                  {t(`appearance.palettes.${key}`)}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-12 font-medium text-fg-3">{t('account.theme.label')}</p>
        <Segmented
          aria-label={t('account.theme.label')}
          value={theme}
          onChange={setTheme}
          className="grid w-full grid-cols-3 [&>button]:justify-center"
          options={[
            {
              value: 'system',
              label: t('account.theme.system'),
              icon: <Monitor aria-hidden size={14} />,
            },
            {
              value: 'light',
              label: t('account.theme.light'),
              icon: <Sun aria-hidden size={14} />,
            },
            { value: 'dark', label: t('account.theme.dark'), icon: <Moon aria-hidden size={14} /> },
          ]}
        />
      </div>
    </div>
  );
}
