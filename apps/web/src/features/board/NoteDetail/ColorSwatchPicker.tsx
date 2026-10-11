import { useTranslation } from 'react-i18next';
import { noteColourValues, type NoteColour } from '@wally/shared';
import { useEnumLabels } from '@/i18n/enumLabels';
import { cn } from '@/lib/cn';
import { noteColourFillClass } from '../util/noteDerived';
import { FieldLabel } from './Field';

interface ColorSwatchPickerProps {
  value: NoteColour;
  onChange: (colour: NoteColour) => void;
  disabled?: boolean;
}

/**
 * Renders whatever packages/shared's noteColourValues defines — currently 14, laid out as
 * two rows of seven. Dusty blue is not among them, for two reasons the guideline gives:
 * blue is functional only (the pin, one CTA, selection), and a blue note would read as
 * selected. The dot shows the note's actual fill, because there is only one value per
 * colour now — what you pick is literally what the note becomes.
 */
export function ColorSwatchPicker({ value, onChange, disabled }: ColorSwatchPickerProps) {
  const { t } = useTranslation();
  const { colour: colourLabels } = useEnumLabels();

  return (
    <div className="flex flex-col gap-2">
      <FieldLabel>{t('note.colourLabel')}</FieldLabel>
      <div className="grid grid-cols-7 justify-items-start gap-2.5">
        {noteColourValues.map((colour) => (
          <button
            key={colour}
            type="button"
            disabled={disabled}
            title={colourLabels[colour]}
            aria-label={colourLabels[colour]}
            aria-pressed={value === colour}
            onClick={() => onChange(colour)}
            className={cn(
              /* 24px, not 22: these are the target, so they carry their own SC 2.5.8 floor. */
              'h-6 w-6 rounded-full border transition-shadow duration-150 disabled:cursor-not-allowed disabled:opacity-55',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)]',
              noteColourFillClass[colour],
              value === colour
                ? 'border-[color:var(--slate)] ring-2 ring-white ring-inset'
                : 'border-border',
            )}
          />
        ))}
      </div>
    </div>
  );
}
