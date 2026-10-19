import { RotateCcw, X } from 'lucide-react';
import type { KeyboardEvent, SyntheticEvent } from 'react';
import type { NoteDto } from '@wally/shared';
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

/** The × that leaves a row out, or the ↺ that brings it back; its label says which. */
function RowToggle({
  pending,
  row,
  name,
}: {
  pending: PendingProps;
  row: ProposalRow;
  name: string;
}) {
  const { t } = useTranslation();
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={t(row.on ? 'suggest.rows.leaveOut' : 'suggest.rows.bringBack', { label: name })}
      onClick={() => toggle(pending, row)}
      onKeyDown={onPress(() => toggle(pending, row))}
      className={cn(
        'flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-[4px] text-fg-faint',
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
  );
}

/**
 * A pending change as Paper Wall v3 draws it inside the card: under a hairline, one line per
 * field (an accent dot, a short label, the value, × or ↺), the cleaned title first and the
 * fields the person typed among them (no button: they are already on the note); then the steps
 * as a checklist with their full text. A row left out is struck through and faded; ↺ brings
 * it back. Rows fade and rise in one after another; none of it moves under reduced motion.
 */
export function ProposalList({ note, pending }: { note: NoteDto; pending: PendingProps }) {
  const { t, i18n } = useTranslation();
  const { priority: priorityLabels, horizon: horizonLabels } = useEnumLabels();
  const rows = proposalRows(note, pending.mark);
  if (rows.length === 0) return null;
  const fieldRows = rows.filter((row) => row.kind !== 'step');
  const steps = rows.filter((row) => row.kind === 'step');

  const text = (row: ProposalRow): [label: string, value: string] => {
    switch (row.kind) {
      case 'title':
        return [t('suggest.rows.title'), row.value];
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
  const reasonOf = (row: ProposalRow) =>
    row.reason ? t('suggest.reason', { reason: row.reason }) : undefined;

  return (
    <span
      data-proposal-list
      className="flex flex-col gap-1.5 border-t border-[color:var(--note-border)] pt-1.5"
      onPointerDown={stop}
      onMouseDown={stop}
      onClick={stop}
    >
      <span role="list" aria-label={t('suggest.rows.list')} className="flex flex-col gap-px">
        {fieldRows.map((row, position) => {
          const [label, value] = text(row);
          return (
            <span
              key={row.id}
              role="listitem"
              data-out={row.on ? undefined : ''}
              data-fixed={row.fixed ? '' : undefined}
              title={reasonOf(row)}
              aria-description={reasonOf(row)}
              style={{ animationDelay: `${position * 100}ms` }}
              className="proposal-row flex min-h-6 items-start gap-2 py-0.5"
            >
              <span
                aria-hidden
                className={cn(
                  'mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full',
                  row.fixed ? 'bg-fg-faint' : 'bg-accent',
                )}
              />
              <span className="w-[60px] shrink-0 pt-px text-12 leading-5 text-fg-meta-on-note">
                {label}
              </span>
              <span
                className={cn(
                  'line-clamp-2 min-w-0 flex-1 break-words text-13 leading-5 text-fg-1',
                  !row.on && 'line-through opacity-45',
                )}
              >
                {value}
              </span>
              {row.fixed ? (
                <span aria-hidden className="h-5 w-5 shrink-0" />
              ) : (
                <RowToggle pending={pending} row={row} name={`${label} ${value}`} />
              )}
            </span>
          );
        })}
      </span>
      {steps.length > 0 && (
        <span role="list" aria-label={t('suggest.rows.steps')} className="flex flex-col gap-1">
          {steps.map((row, position) => {
            const [label, value] = text(row);
            return (
              <span
                key={row.id}
                role="listitem"
                data-out={row.on ? undefined : ''}
                title={reasonOf(row)}
                aria-description={reasonOf(row)}
                style={{ animationDelay: `${(fieldRows.length + position) * 80}ms` }}
                className="proposal-row flex items-start gap-2"
              >
                <span
                  aria-hidden
                  className="mt-[4px] h-3 w-3 shrink-0 rounded-[3px] border border-[color:var(--fg-meta-on-note)] opacity-60"
                />
                <span
                  className={cn(
                    'min-w-0 flex-1 break-words text-13 leading-5 text-fg-1',
                    !row.on && 'line-through opacity-45',
                  )}
                >
                  {value}
                </span>
                <RowToggle pending={pending} row={row} name={`${label} ${value}`} />
              </span>
            );
          })}
        </span>
      )}
    </span>
  );
}
