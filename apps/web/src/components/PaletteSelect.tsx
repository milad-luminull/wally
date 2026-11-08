import { useTranslation } from 'react-i18next';
import { paletteValues, type Palette } from '@wally/shared';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { useTheme } from '@/lib/themeContext';
import { PALETTES } from '@/lib/palettes';

/** The colour palette picker, with each palette's swatches beside its name. */
export function PaletteSelect({ id, className }: { id?: string; className?: string }) {
  const { t } = useTranslation();
  const { palette, setPalette } = useTheme();
  return (
    <Select value={palette} onValueChange={(value) => setPalette(value as Palette)}>
      <SelectTrigger id={id} className={className}>
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
  );
}
