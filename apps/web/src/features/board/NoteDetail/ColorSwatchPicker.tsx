import { useTranslation } from 'react-i18next';
import { noteColourValues, type NoteColour } from '@wally/shared';
import { useEnumLabels } from '@/i18n/enumLabels';
import { cn } from '@/lib/cn';
import { noteColourFillClass } from '../util/noteDerived';

interface ColorSwatchPickerProps {
  value: NoteColour;
  onChange: (colour: NoteColour) => void;
  disabled?: boolean;
}

/**
 * Renders whatever packages/shared's noteColourValues defines — currently 14. The swatch is
 * the note's actual fill token, so what you pick is literally what the note becomes, in
 * either theme. Marigold is deliberately not a note colour: it is the accent.
 */
export function ColorSwatchPicker({ value, onChange, disabled }: ColorSwatchPickerProps) {
  const { t } = useTranslation();
  const { colour: colourLabels } = useEnumLabels();

  return (
    <div
      role="group"
      aria-label={t('note.colourLabel')}
      className="grid grid-cols-7 justify-items-start gap-1.5"
    >
      {/* Two rows of seven; each dot shows the note's actual fill in the current theme. */}
      <>
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
              /* 24px: these are the target, so they carry their own SC 2.5.8 floor. */
              'h-6 w-6 rounded-md border transition-[box-shadow,transform] duration-150 ease-ds disabled:cursor-not-allowed disabled:opacity-50',
              'hover:scale-110 motion-reduce:hover:scale-100',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)]',
              noteColourFillClass[colour],
              value === colour
                ? 'border-[color:var(--fg-1)] ring-2 ring-[color:var(--surface)] ring-inset'
                : 'border-[color:var(--note-border)]',
            )}
          />
        ))}
      </>
    </div>
  );
}
