import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ListFilter, Lock, Search, X } from 'lucide-react';
import { notePriorityValues, type BoardVisibilityFilter, type NotePriority } from '@wally/shared';
import { useEnumLabels } from '@/i18n/enumLabels';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { RemoveButton } from '@/components/ui/remove-button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { cn } from '@/lib/cn';
import { PriorityIcon } from './PriorityIcon';
import type { BoardViewState } from './hooks/useBoardViewState';

interface FilterBarProps {
  view: BoardViewState;
  setQuery: (q: string) => void;
  setPriority: (priority: NotePriority[]) => void;
  setMine: (mine: boolean) => void;
  setDone: (done: boolean) => void;
  setFieldKey: (key: string | null) => void;
  setFieldValue: (value: string | null) => void;
  setVisibility: (v: BoardVisibilityFilter) => void;
  /** Puts every filter back to its default in one saved write — see useBoardViewState. */
  resetFilters: () => void;
  /** Whether the private/shared chips are offered — see showsVisibilityFilter. */
  showVisibility: boolean;
  /** Every custom-property key/value in use on this board — see collectFieldKeys. */
  fieldKeys: string[];
  fieldValues: string[];
  isBelowTablet: boolean;
}

const ANY_VALUE = '__any__';

/** Filter by a user-defined note property: pick the property, then optionally one of the
 * values actually recorded for it on this board. */
function FieldFilter({
  view,
  fieldKeys,
  fieldValues,
  setFieldKey,
  setFieldValue,
}: Pick<FilterBarProps, 'view' | 'fieldKeys' | 'fieldValues' | 'setFieldKey' | 'setFieldValue'>) {
  const { t } = useTranslation();
  if (!fieldKeys.length) return null;

  return (
    <div className="flex items-center gap-2">
      <Select
        value={view.fieldKey ?? ANY_VALUE}
        onValueChange={(v) => setFieldKey(v === ANY_VALUE ? null : v)}
      >
        <SelectTrigger
          aria-label={t('board.filter.fieldAria')}
          className="h-7 w-[140px] text-12 [@media(pointer:coarse)]:h-10"
        >
          <SelectValue placeholder={t('board.filter.fieldPlaceholder')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY_VALUE}>{t('board.filter.anyField')}</SelectItem>
          {fieldKeys.map((key) => (
            <SelectItem key={key} value={key}>
              {key}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {view.fieldKey && (
        <Select
          value={view.fieldValue ?? ANY_VALUE}
          onValueChange={(v) => setFieldValue(v === ANY_VALUE ? null : v)}
        >
          <SelectTrigger
            aria-label={t('board.filter.valueAria')}
            className="h-7 w-[140px] text-12 [@media(pointer:coarse)]:h-10"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_VALUE}>{t('board.filter.anyValue')}</SelectItem>
            {fieldValues.map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

/** Focused from anywhere by the `/` shortcut (see lib/shortcuts). */
export const SEARCH_INPUT_ID = 'board-search';

function SearchInput({ q, setQuery }: { q: string; setQuery: (q: string) => void }) {
  const { t } = useTranslation();
  const [local, setLocal] = useState(q);
  const debounced = useDebouncedValue(local, 250);

  useEffect(() => setLocal(q), [q]);
  useEffect(() => {
    if (debounced !== q) setQuery(debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  return (
    <div
      className={cn(
        'group flex h-7 min-w-[180px] max-w-[280px] flex-1 items-center gap-2 rounded-md border border-border bg-surface px-2.5 shadow-e1',
        '[@media(pointer:coarse)]:h-10',
        'transition-[border-color,box-shadow] duration-150 ease-ds hover:border-border-strong',
        'focus-within:border-border-strong focus-within:ring-2 focus-within:ring-[color:var(--ring-alpha)]',
      )}
    >
      <Search className="h-3.5 w-3.5 shrink-0 text-fg-faint" strokeWidth={1.75} />
      <input
        id={SEARCH_INPUT_ID}
        value={local}
        onKeyDown={(e) => {
          if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
        }}
        onChange={(e) => setLocal(e.target.value)}
        placeholder={t('board.filter.searchPlaceholder')}
        aria-label={t('board.filter.searchAria')}
        /* h-full, so the field's own box is the full pill height rather than the 18px the
           text line occupies — the shell was already the visible target, but the input was
           what a pointer had to land on. */
        className="h-full min-w-0 flex-1 bg-transparent text-13 text-fg-1 outline-none placeholder:text-fg-faint [@media(pointer:coarse)]:text-16"
      />
      {local ? (
        <RemoveButton
          label={t('board.filter.clearSearch')}
          onClick={() => setLocal('')}
          className="-mr-1.5 h-5 w-5"
        />
      ) : (
        <kbd aria-hidden className="kbd hidden group-focus-within:hidden lg:inline-flex">
          /
        </kbd>
      )}
    </div>
  );
}

function PriorityChips({
  priority,
  setPriority,
}: {
  priority: NotePriority[];
  setPriority: (p: NotePriority[]) => void;
}) {
  const { t } = useTranslation();
  const { priority: priorityLabels } = useEnumLabels();

  return (
    <ToggleGroup
      type="multiple"
      variant="chip"
      value={priority}
      onValueChange={(v) => setPriority(v as NotePriority[])}
    >
      {notePriorityValues.map((p) => (
        <ToggleGroupItem
          key={p}
          value={p}
          aria-label={t('board.filter.priorityAria', { label: priorityLabels[p] })}
        >
          <PriorityIcon priority={p} size={12} />
          {priorityLabels[p]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function BooleanToggles({
  mine,
  setMine,
  done,
  setDone,
}: {
  mine: boolean;
  setMine: (v: boolean) => void;
  done: boolean;
  setDone: (v: boolean) => void;
}) {
  const { t } = useTranslation();

  return (
    <>
      <Toggle variant="chip" pressed={mine} onPressedChange={setMine}>
        {t('board.filter.mine')}
      </Toggle>
      {/* Phrased as "hide", so the chip is OFF in the default state — an ink-filled chip at
          rest would read as a filter someone left on. */}
      <Toggle variant="chip" pressed={!done} onPressedChange={(hide) => setDone(!hide)}>
        {t('board.filter.done')}
      </Toggle>
    </>
  );
}

function VisibilityChips({
  visibility,
  setVisibility,
}: {
  visibility: BoardVisibilityFilter;
  setVisibility: (v: BoardVisibilityFilter) => void;
}) {
  const { t } = useTranslation();
  return (
    <ToggleGroup
      type="single"
      variant="chip"
      aria-label={t('board.filter.visibilityAria')}
      value={visibility === 'all' ? '' : visibility}
      onValueChange={(v) => setVisibility((v || 'all') as BoardVisibilityFilter)}
    >
      <ToggleGroupItem value="private">
        <Lock strokeWidth={1.75} />
        {t('board.filter.onlyPrivate')}
      </ToggleGroupItem>
      <ToggleGroupItem value="shared">{t('board.filter.hidePrivate')}</ToggleGroupItem>
    </ToggleGroup>
  );
}

/** Below 720px only (the one place mobile and tablet legitimately differ — tablet still
 * has room for the inline row per the plan's responsive table). */
export function FilterBar({
  view,
  setQuery,
  setPriority,
  setMine,
  setDone,
  setFieldKey,
  setFieldValue,
  setVisibility,
  resetFilters,
  showVisibility,
  fieldKeys,
  fieldValues,
  isBelowTablet,
}: FilterBarProps) {
  const { t } = useTranslation();
  const activeFilterCount =
    view.priority.length +
    (view.mine ? 1 : 0) +
    (view.done ? 0 : 1) +
    (view.fieldKey ? 1 : 0) +
    (view.visibility !== 'all' ? 1 : 0);
  const hasActiveFilters = activeFilterCount > 0;

  if (isBelowTablet) {
    return (
      <div className="board-filters flex shrink-0 items-center gap-2 border-b border-border-subtle bg-surface px-3 py-2">
        <SearchInput q={view.q} setQuery={setQuery} />
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm" className="shrink-0">
              <ListFilter strokeWidth={1.75} />
              {t('board.filter.title')}
              {hasActiveFilters && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold tabular-nums text-primary-foreground">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="px-5 pb-6">
            <SheetHeader className="border-0 px-0 pb-4 pt-3">
              <SheetTitle>{t('board.filter.title')}</SheetTitle>
            </SheetHeader>
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-2.5">
                <span className="text-12 font-medium text-fg-3">
                  {t('board.filter.priorityHeading')}
                </span>
                <PriorityChips priority={view.priority} setPriority={setPriority} />
              </div>
              {fieldKeys.length > 0 && (
                <div className="flex flex-col gap-2.5">
                  <span className="text-12 font-medium text-fg-3">
                    {t('board.filter.fieldHeading')}
                  </span>
                  <FieldFilter
                    view={view}
                    fieldKeys={fieldKeys}
                    fieldValues={fieldValues}
                    setFieldKey={setFieldKey}
                    setFieldValue={setFieldValue}
                  />
                </div>
              )}
              <div className="flex flex-col gap-2.5">
                <span className="text-12 font-medium text-fg-3">
                  {t('board.filter.showHeading')}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <BooleanToggles
                    mine={view.mine}
                    setMine={setMine}
                    done={view.done}
                    setDone={setDone}
                  />
                  {showVisibility && (
                    <VisibilityChips visibility={view.visibility} setVisibility={setVisibility} />
                  )}
                </div>
              </div>
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={resetFilters} className="self-start">
                  {t('board.filter.resetLong')}
                </Button>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    );
  }

  return (
    <div className="board-filters flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-subtle bg-surface px-3 py-2 lg:px-4">
      <SearchInput q={view.q} setQuery={setQuery} />
      <div className="flex flex-wrap items-center gap-1.5">
        <PriorityChips priority={view.priority} setPriority={setPriority} />
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <BooleanToggles mine={view.mine} setMine={setMine} done={view.done} setDone={setDone} />
        {showVisibility && (
          <VisibilityChips visibility={view.visibility} setVisibility={setVisibility} />
        )}
        <FieldFilter
          view={view}
          fieldKeys={fieldKeys}
          fieldValues={fieldValues}
          setFieldKey={setFieldKey}
          setFieldValue={setFieldValue}
        />
      </div>
      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={resetFilters}>
          <X strokeWidth={1.75} />
          {t('board.filter.reset')}
        </Button>
      )}
    </div>
  );
}
