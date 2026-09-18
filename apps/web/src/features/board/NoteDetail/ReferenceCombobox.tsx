import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { REFERENCE_TYPE_LABELS, referenceTypeValues, type ReferenceType } from '@wally/shared';
import { referenceOptionsApi } from '@/lib/resources';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';
import { Input } from '@/components/ui/input';

const NONE = '__none__';

interface ReferenceComboboxProps {
  referenceType: ReferenceType | null;
  referenceLabel: string | null;
  onChange: (type: ReferenceType | null, label: string | null) => void;
  disabled?: boolean;
}

/** Type selector (Kunde/Vertrag/Schaden) + free-text label with autocomplete suggestions
 * from GET /reference-options — typing beyond the suggestion list is always allowed, the
 * options are hints, not a closed vocabulary (SPEC §5: "exact supported reference types
 * may depend on the surrounding platform"). */
export function ReferenceCombobox({ referenceType, referenceLabel, onChange, disabled }: ReferenceComboboxProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(referenceLabel ?? '');

  // The panel reuses this component across whichever note is selected rather than
  // remounting it, so the local draft has to resync whenever the caller's note changes
  // out from under it (same reasoning as NoteDetailPanel's own title field).
  useEffect(() => {
    setDraft(referenceLabel ?? '');
  }, [referenceLabel]);

  const { data: options = [] } = useQuery({
    queryKey: ['referenceOptions', referenceType],
    queryFn: () => referenceOptionsApi.list(referenceType!),
    enabled: Boolean(referenceType),
  });

  function handleTypeChange(next: string) {
    if (next === NONE) {
      setDraft('');
      onChange(null, null);
      return;
    }
    onChange(next as ReferenceType, referenceLabel);
  }

  function commitLabel(value: string) {
    setDraft(value);
    onChange(referenceType, value.trim() || null);
    setOpen(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-12 font-semibold text-fg-muted">Bezug</span>
      <div className="grid grid-cols-[minmax(0,120px)_1fr] gap-3">
        <Select value={referenceType ?? NONE} onValueChange={handleTypeChange} disabled={disabled}>
          <SelectTrigger aria-label="Bezugstyp">
            <SelectValue placeholder="Kein Bezug" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Kein Bezug</SelectItem>
            {referenceTypeValues.map((type) => (
              <SelectItem key={type} value={type}>
                {REFERENCE_TYPE_LABELS[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Popover open={open && Boolean(referenceType)} onOpenChange={setOpen}>
          <PopoverAnchor asChild>
            <Input
              value={draft}
              disabled={disabled || !referenceType}
              placeholder="Kunde, Vertrag, Schaden"
              onFocus={() => referenceType && setOpen(true)}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => commitLabel(draft)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitLabel(draft);
                }
                if (e.key === 'Escape') setOpen(false);
              }}
              className="h-[30px] border-0 border-b border-border-subtle p-0 focus-visible:ring-0"
            />
          </PopoverAnchor>
          <PopoverContent className="w-72 p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
            <Command shouldFilter>
              <CommandList>
                <CommandEmpty>Keine Vorschläge — Freitext möglich.</CommandEmpty>
                <CommandGroup>
                  {options.map((option) => (
                    <CommandItem key={option.id} value={option.label} onSelect={() => commitLabel(option.label)}>
                      {option.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
