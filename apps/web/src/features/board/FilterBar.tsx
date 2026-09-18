import { useEffect, useState } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';
import { PRIORITY_LABELS, notePriorityValues, type NotePriority } from '@wally/shared';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { priorityToneClass } from './util/noteDerived';
import type { BoardViewState } from './hooks/useBoardViewState';

interface FilterBarProps {
  view: BoardViewState;
  setQuery: (q: string) => void;
  setPriority: (priority: NotePriority[]) => void;
  setMine: (mine: boolean) => void;
  setDone: (done: boolean) => void;
  isBelowTablet: boolean;
}

function SearchInput({ q, setQuery }: { q: string; setQuery: (q: string) => void }) {
  const [local, setLocal] = useState(q);
  const debounced = useDebouncedValue(local, 250);

  useEffect(() => setLocal(q), [q]);
  useEffect(() => {
    if (debounced !== q) setQuery(debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  return (
    <div className="flex min-w-[180px] max-w-[320px] flex-1 items-center gap-2">
      <Search className="h-3.5 w-3.5 shrink-0 text-fg-3" strokeWidth={1.6} />
      <Input
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder="Suchen"
        aria-label="Notizen durchsuchen"
        className="h-7 border-0 border-b border-transparent p-0 text-13 focus-visible:border-border-input focus-visible:ring-0"
      />
    </div>
  );
}

function PriorityChips({ priority, setPriority }: { priority: NotePriority[]; setPriority: (p: NotePriority[]) => void }) {
  return (
    <ToggleGroup type="multiple" variant="chip" value={priority} onValueChange={(v) => setPriority(v as NotePriority[])}>
      {notePriorityValues.map((p) => (
        <ToggleGroupItem key={p} value={p} aria-label={`Nach Priorität ${PRIORITY_LABELS[p]} filtern`}>
          <span className={`h-1.5 w-1.5 rounded-full ${priorityToneClass[p]}`} />
          {PRIORITY_LABELS[p]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function BooleanToggles({ mine, setMine, done, setDone }: { mine: boolean; setMine: (v: boolean) => void; done: boolean; setDone: (v: boolean) => void }) {
  return (
    <>
      <span className="mx-1 h-4 w-px bg-border" aria-hidden />
      <Toggle variant="chip" size="sm" pressed={mine} onPressedChange={setMine} className="h-[26px] border border-transparent">
        Nur meine
      </Toggle>
      <Toggle variant="chip" size="sm" pressed={done} onPressedChange={setDone} className="h-[26px] border border-transparent">
        Erledigte
      </Toggle>
    </>
  );
}

/** Below 720px only (the one place mobile and tablet legitimately differ — tablet still
 * has room for the inline row per the plan's responsive table). */
export function FilterBar({ view, setQuery, setPriority, setMine, setDone, isBelowTablet }: FilterBarProps) {
  const activeFilterCount = view.priority.length + (view.mine ? 1 : 0) + (view.done ? 0 : 1);

  if (isBelowTablet) {
    return (
      <div className="flex items-center gap-3 px-6 pb-3.5">
        <SearchInput q={view.q} setQuery={setQuery} />
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filter
              {activeFilterCount > 0 && <span className="tabular-nums">({activeFilterCount})</span>}
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom">
            <SheetHeader className="border-0 p-0 pb-4">
              <SheetTitle>Filter</SheetTitle>
            </SheetHeader>
            <div className="flex flex-col gap-4 pb-4">
              <PriorityChips priority={view.priority} setPriority={setPriority} />
              <div className="flex items-center gap-2">
                <BooleanToggles mine={view.mine} setMine={setMine} done={view.done} setDone={setDone} />
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 px-6 pb-3.5">
      <SearchInput q={view.q} setQuery={setQuery} />
      <div className="flex flex-wrap items-center gap-1.5">
        <PriorityChips priority={view.priority} setPriority={setPriority} />
        <BooleanToggles mine={view.mine} setMine={setMine} done={view.done} setDone={setDone} />
      </div>
    </div>
  );
}
