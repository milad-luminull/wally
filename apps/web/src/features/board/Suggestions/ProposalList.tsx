import { RotateCcw, X } from 'lucide-react';
import type { KeyboardEvent, SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useEnumLabels } from '@/i18n/enumLabels';
import { cn } from '@/lib/cn';
import { proposedDateLabel, type PendingProps } from './pendingProps';
import { proposalRows, type ProposalRow } from './proposalRows';

const stop = (e: SyntheticEvent) => e.stopPropagation();
/** Enter and Space press a `role="button"` span, and go no further than it. */
const onPress = (action: () => void) => (e: KeyboardEvent) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  e.stopPropagation();
  action();
};

/** Takes one row into the change or out of it, through the callback its field uses. */
function toggle(pending: PendingProps, row: ProposalRow) {
  const on = !row.on;
  const index = row.index ?? -1;
  switch (row.field) {
    case 'subtasks':
      return pending.onSetSubtask(index, on);
    case 'links':
      return pending.onSetLink(index, on);
    case 'tags':
      return pending.onSetTag(index, on);
    case 'properties':
      return pending.onSetProperty(index, on);
    default:
      return pending.onSetField(row.field, on);
  }
}

/**
 * A pending change as a labelled list (the smarter-capture spec §5, after Paper Wall v3):
 * every proposed field or item on its own line, under a hairline, in the note's own type and
 * colour, its reason the tooltip and the accessible description. The × leaves a row out
 * (struck through, faded) and turns into ↺, which brings it back; Private starts out, since
 * only the person takes it. Rows fade and rise in one after another (opacity and transform
 * only, none under reduced motion). The same list serves the wall card and the list row.
 */
export function ProposalList({ pending }: { pending: PendingProps }) {
  const { t, i18n } = useTranslation();
  const { priority: priorityLabels, horizon: horizonLabels } = useEnumLabels();
  const rows = proposalRows(pending.mark);
  if (rows.length === 0) return null;

  const text = (row: ProposalRow): [label: string, value: string] => {
    switch (row.kind) {
      case 'date':
        return [t('suggest.rows.dueDate'), proposedDateLabel(row.iso, i18n.language)];
      case 'horizon':
        return [t('suggest.rows.horizon'), horizonLabels[row.value]];
      case 'priority':
        return [t('suggest.rows.priority'), priorityLabels[row.value]];
      case 'person':
        return [t('suggest.rows.assignee'), row.user.displayName ?? row.user.email];
      case 'private':
        return [t('suggest.rows.visibility'), t('suggest.rows.privateValue')];
      case 'property':
        return [row.key, row.value];
      case 'tag':
        return [t('suggest.rows.tag'), row.value];
      case 'step':
        return [t('suggest.rows.step'), row.text];
      case 'link':
        return [t('suggest.rows.link'), row.title || t('common.untitled')];
    }
  };

  return (
    <span
      role="list"
      aria-label={t('suggest.rows.list')}
      data-proposal-list
      className="flex flex-col gap-px border-t border-[color:var(--note-border)] pt-1.5"
      onPointerDown={stop}
      onMouseDown={stop}
      onClick={stop}
    >
      {rows.map((row, position) => {
        const [label, value] = text(row);
        const reason = row.reason ? t('suggest.reason', { reason: row.reason }) : undefined;
        const name = `${label} ${value}`;
        return (
          <span
            key={row.id}
            role="listitem"
            data-out={row.on ? undefined : ''}
            title={reason}
            aria-description={reason}
            style={{ animationDelay: `${position * 100}ms` }}
            className="proposal-row flex min-h-6 items-center gap-2"
          >
            <span aria-hidden className="h-[5px] w-[5px] shrink-0 rounded-full bg-accent" />
            <span className="w-[4.25rem] shrink-0 truncate text-12 text-fg-meta-on-note">
              {label}
            </span>
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-13 text-fg-1',
                !row.on && 'line-through opacity-45',
              )}
            >
              {value}
            </span>
            <span
              role="button"
              tabIndex={0}
              aria-pressed={row.on}
              aria-label={t(row.on ? 'suggest.rows.leaveOut' : 'suggest.rows.bringBack', {
                label: name,
              })}
              onClick={() => toggle(pending, row)}
              onKeyDown={onPress(() => toggle(pending, row))}
              className={cn(
                'flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-[3px] text-fg-faint',
                'transition-colors duration-100 hover:bg-inset-hover hover:text-fg-1',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)]',
                '[@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10',
              )}
            >
              {row.on ? (
                <X className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
              ) : (
                <RotateCcw className="h-3 w-3" strokeWidth={1.9} aria-hidden />
              )}
            </span>
          </span>
        );
      })}
    </span>
  );
}
