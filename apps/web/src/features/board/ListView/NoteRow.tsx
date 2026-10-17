import type { MouseEvent } from 'react';
import type { NoteDto } from '@wally/shared';
import { useTranslation } from 'react-i18next';
import { useEnumLabels } from '@/i18n/enumLabels';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/cn';
import { dueInfo, dueToneClass, noteColourFillClass, subtaskCountLabel } from '../util/noteDerived';
import { PriorityIcon } from '../PriorityIcon';
import { PrivateBadge } from '../PrivateBadge';
import { PendingDot } from '../Suggestions/PendingDot';
import { ProposedField } from '../Suggestions/ProposedField';
import {
  pendingKeys,
  proposedDateLabel,
  proposedTitle,
  proposedValues,
  type PendingProps,
} from '../Suggestions/pendingProps';
import { usePendingPause } from '../Suggestions/usePendingPause';

interface NoteRowProps {
  note: NoteDto;
  currentUserId: string | undefined;
  onOpen: () => void;
  onToggleDone: () => void;
  canEdit: boolean;
  /** A change Wallybot proposed for this note, still pending or just kept (§3.3). */
  pending?: PendingProps;
}

export function NoteRow({
  note,
  currentUserId,
  onOpen,
  onToggleDone,
  canEdit,
  pending,
}: NoteRowProps) {
  const { t, i18n } = useTranslation();
  const { priority: priorityLabels } = useEnumLabels();
  const due = dueInfo(note, t);
  const checklistLabel = subtaskCountLabel(note.subtaskSummary);
  const isDone = note.status === 'DONE';
  const isPrivate = note.visibility === 'PRIVATE';
  const proposed = proposedValues(note, pending);
  const proposedDate = proposed.dueDate && proposedDateLabel(proposed.dueDate.value, i18n.language);
  const dashed = pending !== undefined && pending.mark.phase !== 'kept';
  // Only a pending change has fields to take out; a kept one shows its values plainly.
  const removable = pending?.mark.phase === 'pending';
  // The offered title shows ticked or not, and only while the change is pending (R2).
  const offeredTitle = removable ? proposedTitle(pending.mark) : null;
  const titleTaken = pending?.mark.fields.includes('title') ?? false;
  const offeredTitleLabel =
    offeredTitle && t('suggest.title.proposed', { title: offeredTitle.value });
  const referenceLabel =
    proposed.reference &&
    t('suggest.fields.reference', {
      key: proposed.reference.key,
      value: proposed.reference.value,
    });
  const stepsLabel =
    proposed.subtasks && t('suggest.fields.subtasks', { count: proposed.subtasks.kept.length });
  const pause = usePendingPause(pending);

  // Always named, yourself included: leaving your own name out made "assigned to me" read
  // exactly like "assigned to nobody".
  // A private note shows a lock instead: it is always its author's, so naming them says nothing.
  const assigneeName = isPrivate
    ? undefined
    : note.assignee
      ? note.assignee.id === currentUserId
        ? t('common.you')
        : (note.assignee.displayName ?? note.assignee.email)
      : undefined;
  // First property alphabetically, so the meta line is stable rather than following
  // whatever order Firestore returns the map in.
  const [firstField] = Object.entries(note.customFields ?? {}).sort(([a], [b]) =>
    a.localeCompare(b, 'de'),
  );
  const fieldLabel = firstField ? `${firstField[0]}: ${firstField[1]}` : undefined;
  const metaParts = [fieldLabel, assigneeName, checklistLabel || undefined].filter(Boolean);

  function handleCheckboxClick(e: MouseEvent) {
    e.stopPropagation();
    onToggleDone();
  }

  return (
    <div
      role="button"
      tabIndex={0}
      // The same address the wall's cards carry, so the board can focus the row after a
      // commit (useCaptureSession) and Enter keeps from there.
      data-note-id={note.id}
      data-pending={pending?.mark.phase}
      onClick={onOpen}
      onKeyDown={(e) => {
        // Enter keeps and Esc discards while a change is pending, instead of opening.
        if (pendingKeys(e, pending)) return;
        // A key meant for a control inside the row (the checkbox, the Undo) is not "open".
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      {...pause}
      className={cn(
        'group/row relative flex min-h-10 cursor-pointer items-center gap-3 px-3 py-2',
        'border-b border-border-subtle last:border-b-0',
        'transition-colors duration-100 hover:bg-surface-alt',
        'focus-visible:bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--ring-alpha)]',
        '[@media(pointer:coarse)]:min-h-12',
        // A pending change: a dashed left edge in the note's border colour, never marigold
        // (BRAND job 4). Only the left edge's style changes, so the divider below stays
        // solid. The padding gives back the edge's 2px, so the row does not shift.
        dashed &&
          'border-l-2 border-l-[color:var(--note-border)] pl-2.5 [border-left-style:dashed]',
      )}
    >
      <Checkbox
        checked={isDone}
        onClick={handleCheckboxClick}
        disabled={!canEdit}
        aria-label={isDone ? t('board.rowStatus.markOpen') : t('board.rowStatus.markDone')}
        className="shrink-0"
      />

      {/* The note's colour as a swatch: the same note is the same object in both views,
          without painting a whole row of the list. White notes need no marker. */}
      {note.colour !== 'WEISS' && (
        <span
          aria-hidden
          className={cn(
            'h-2.5 w-2.5 shrink-0 rounded-[3px] border border-[color:var(--note-border)]',
            noteColourFillClass[note.colour],
          )}
        />
      )}

      <div
        className={cn(
          'flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1',
          isDone && 'opacity-55',
        )}
      >
        <span
          className={cn(
            'min-w-0 truncate text-13 font-medium text-fg-1',
            isDone && 'line-through decoration-fg-faint',
          )}
        >
          {note.title || t('common.untitled')}
        </span>

        {/* A cleaner title is a full-width second line under the person's own, never a
            replacement (BRAND rule 7): a tap takes it into the change, its × keeps theirs. */}
        {offeredTitle && offeredTitleLabel && pending && (
          <ProposedField
            className="basis-full items-start"
            name={offeredTitleLabel}
            label={
              <span
                className={cn(
                  'line-clamp-2 text-12 leading-snug',
                  titleTaken ? 'text-fg-1' : 'text-fg-3',
                )}
              >
                {offeredTitleLabel}
              </span>
            }
            reason={offeredTitle.reason}
            toggle={{
              pressed: titleTaken,
              onToggle: () => pending.onSetField('title', !titleTaken),
              description: t('suggest.title.take'),
            }}
            removeLabel={t('suggest.title.mine')}
            onRemove={() => pending.onRemove('title')}
          />
        )}

        {isPrivate && <PrivateBadge className="text-fg-3" />}

        {/* The proposed reference and steps sit where the note's own property and checklist
            count would: the note has neither while they are proposed (R7). */}
        {proposed.reference && referenceLabel && (
          <ProposedField
            className="text-12 text-fg-3"
            name={referenceLabel}
            label={referenceLabel}
            reason={proposed.reference.reason}
            onRemove={removable ? () => pending?.onRemove('reference') : undefined}
          />
        )}
        {metaParts.length > 0 && (
          <span className="truncate text-12 text-fg-3">{metaParts.join(' · ')}</span>
        )}
        {proposed.assignee && (
          <ProposedField
            className="text-12 text-fg-3"
            name={t('suggest.fields.assignee', {
              name: proposed.assignee.value.displayName ?? proposed.assignee.value.email,
            })}
            label={
              proposed.assignee.value.id === currentUserId
                ? t('common.you')
                : (proposed.assignee.value.displayName ?? proposed.assignee.value.email)
            }
            reason={proposed.assignee.reason}
            onRemove={removable ? () => pending?.onRemove('assignee') : undefined}
          />
        )}
        {proposed.subtasks && stepsLabel && (
          <ProposedField
            className="text-12 tabular-nums text-fg-3"
            name={stepsLabel}
            label={stepsLabel}
            reason={proposed.subtasks.reason}
            onRemove={removable ? () => pending?.onRemove('subtasks') : undefined}
          />
        )}
        {note.tags.map((tag) => (
          <span
            key={tag}
            className="rounded-[4px] border border-border bg-surface-alt px-1.5 text-12 leading-5 text-fg-2"
          >
            {tag}
          </span>
        ))}
      </div>

      <div className={cn('flex shrink-0 items-center gap-2.5', isDone && 'opacity-55')}>
        <span
          className={cn('whitespace-nowrap text-12 tabular-nums', dueToneClass[due.tone])}
          style={{ fontWeight: due.weight }}
        >
          {proposed.dueDate && proposedDate ? (
            <ProposedField
              name={t('suggest.fields.dueDate', { date: proposedDate })}
              label={
                <span
                  className={cn(
                    'text-12 tabular-nums',
                    dueToneClass[
                      dueInfo({ status: 'OPEN', dueDate: proposed.dueDate.value }, t).tone
                    ],
                  )}
                >
                  {proposedDate}
                </span>
              }
              reason={proposed.dueDate.reason}
              onRemove={removable ? () => pending?.onRemove('dueDate') : undefined}
            />
          ) : (
            due.label
          )}
        </span>
        {proposed.priority ? (
          <ProposedField
            name={t(
              proposed.priority.value === 'HOCH'
                ? 'suggest.fields.priorityHigh'
                : 'suggest.fields.priorityLow',
            )}
            label={
              <PriorityIcon
                priority={proposed.priority.value}
                label={t('board.priorityPrefix', {
                  label: priorityLabels[proposed.priority.value],
                })}
              />
            }
            reason={proposed.priority.reason}
            onRemove={removable ? () => pending?.onRemove('priority') : undefined}
          />
        ) : (
          !isDone && (
            <PriorityIcon
              priority={note.priority}
              label={t('board.priorityPrefix', { label: priorityLabels[note.priority] })}
            />
          )
        )}
        {pending && <PendingDot mark={pending.mark} onUndo={() => pending.onUndo('click')} />}
      </div>
    </div>
  );
}
