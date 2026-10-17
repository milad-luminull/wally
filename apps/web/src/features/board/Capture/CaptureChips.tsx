import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { RemoveButton } from '@/components/ui/remove-button';
import type { CaptureParse } from '@/lib/capture/parseCapture';
import { dueInfo, dueToneClass } from '../util/noteDerived';

export type ChipKind = 'dueDate' | 'assignee' | 'priority';
export interface ChipState {
  kept: Record<ChipKind, boolean>;
  dropped: Record<ChipKind, boolean>;
}

/**
 * The parser's proposals under the title: date, person, priority. Kept unless the card says
 * otherwise; a tap toggles, `×` drops for this capture. Same type and colour as the note; the
 * due date's text carries the status colour the card would show. Nothing here writes anything.
 * Each control is named after its suggestion, and both grow to 40px on a coarse pointer.
 */
export function CaptureChips({
  parse,
  memberName,
  dateLabel,
  state,
  onToggle,
  onDrop,
}: {
  parse: CaptureParse;
  memberName: string | null;
  dateLabel: string | null;
  state: ChipState;
  onToggle: (kind: ChipKind) => void;
  onDrop: (kind: ChipKind) => void;
}) {
  const { t } = useTranslation();
  const chips: { kind: ChipKind; label: string; tone?: string }[] = [];
  if (parse.dueDate && dateLabel && !state.dropped.dueDate)
    chips.push({
      kind: 'dueDate',
      label: t('capture.chips.due', { date: dateLabel }),
      tone: dueToneClass[dueInfo({ status: 'OPEN', dueDate: parse.dueDate.iso }, t).tone],
    });
  if (parse.assignee && memberName && !state.dropped.assignee)
    chips.push({ kind: 'assignee', label: t('capture.chips.assignee', { name: memberName }) });
  if (parse.priority && !state.dropped.priority)
    chips.push({
      kind: 'priority',
      label: t(
        parse.priority.value === 'HOCH'
          ? 'capture.chips.priorityHigh'
          : 'capture.chips.priorityLow',
      ),
    });
  if (chips.length === 0) return null;
  return (
    // Keeps the title focused while a chip is clicked, so a click on a chip never blurs (and so
    // never commits) the capture.
    <div className="flex flex-wrap gap-1.5" onMouseDown={(e) => e.preventDefault()}>
      {chips.map(({ kind, label, tone }) => (
        <span
          key={kind}
          data-chip={kind}
          className={cn(
            'inline-flex h-6 items-center gap-1 rounded-[4px] border border-border bg-surface-alt pl-1.5 pr-0.5 text-12 leading-5 text-fg-2',
            '[@media(pointer:coarse)]:h-11',
            !state.kept[kind] && 'opacity-50 line-through decoration-fg-faint',
          )}
        >
          <button
            type="button"
            onClick={() => onToggle(kind)}
            aria-pressed={state.kept[kind]}
            aria-label={label}
            className={cn(
              'rounded-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)]',
              '[@media(pointer:coarse)]:h-10',
              tone,
            )}
          >
            {label}
          </button>
          <RemoveButton
            onClick={() => onDrop(kind)}
            label={t('capture.chips.dropNamed', { label })}
            className="h-5 w-5 rounded-[3px] [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10"
          />
        </span>
      ))}
    </div>
  );
}
