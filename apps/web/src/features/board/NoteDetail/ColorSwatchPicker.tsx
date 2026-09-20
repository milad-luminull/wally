import { noteColourValues, type NoteColour } from '@wally/shared';
import { useEnumLabels } from '@/i18n/enumLabels';
import { cn } from '@/lib/cn';
import { noteColourSwatchClass } from '../util/noteDerived';
import { FieldLabel } from './Field';

interface ColorSwatchPickerProps {
  value: NoteColour;
  onChange: (colour: NoteColour) => void;
  disabled?: boolean;
}

/**
 * Renders whatever packages/shared's noteColourValues defines — currently 14, laid out as
 * two rows of seven. Apricot is not among them: Finlex's design system reserves apricot for
 * functional accents only (primary CTA, active state, focus ring), never a decorative
 * note-colour choice, so there is no "Apricot" option here, unlike the reference mockup.
 */
export function ColorSwatchPicker({ value, onChange, disabled }: ColorSwatchPickerProps) {
  const { colour: colourLabels } = useEnumLabels();

  return (
    <div className="flex flex-col gap-2">
      <FieldLabel>Farbe</FieldLabel>
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
              noteColourSwatchClass[colour],
              value === colour ? 'border-primary ring-2 ring-white ring-inset' : 'border-border',
            )}
          />
        ))}
      </div>
    </div>
  );
}
