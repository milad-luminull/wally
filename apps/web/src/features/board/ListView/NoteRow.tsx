import type { MouseEvent } from 'react';
import type { NoteDto } from '@wally/shared';
import { useTranslation } from 'react-i18next';
import { useEnumLabels } from '@/i18n/enumLabels';
import { useLanguage } from '@/i18n/LanguageProvider';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/cn';
import { dueInfo, dueToneClass, noteColourFillClass, subtaskCountLabel } from '../util/noteDerived';
import { PriorityIcon } from '../PriorityIcon';
import { PrivateBadge } from '../PrivateBadge';
import { PendingDot } from '../Suggestions/PendingDot';
import { ProposalList } from '../Suggestions/ProposalList';
import { ProposedField } from '../Suggestions/ProposedField';
import { ReviewFooter } from '../Suggestions/ReviewFooter';
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
  /** How many notes of the board this one is related to, both ways (`relatedCounts`, L1, L7). */
  relatedCount?: number;
}

export function NoteRow({
  note,
  currentUserId,
  onOpen,
  onToggleDone,
  canEdit,
  pending,
  relatedCount = 0,
}: NoteRowProps) {
  const { t, i18n } = useTranslation();
  const { language } = useLanguage();
  const { priority: priorityLabels } = useEnumLabels();
  const due = dueInfo(note, t);
  const checklistLabel = subtaskCountLabel(note.subtaskSummary);
  const isDone = note.status === 'DONE';
  const isPrivate = note.visibility === 'PRIVATE';
  // A pending change is drawn as its list under the title; only a kept one shows its values
  // in their places, until the refetch carries them.
  const proposed = proposedValues(note, pending?.mark.phase === 'kept' ? pending : undefined);
  // The list and its footer: while the call runs and while the change waits for a decision.
  const reviewing = pending && pending.mark.phase !== 'kept' ? pending : undefined;
  const proposedDate = proposed.dueDate && proposedDateLabel(proposed.dueDate.value, i18n.language);
  const dashed = pending !== undefined && pending.mark.phase !== 'kept';
  // Only a pending change has fields to take out; a kept one shows its values plainly.
  const removable = pending?.mark.phase === 'pending';
  // The offered title shows ticked or not, and only while the change is pending (R2).
  const offeredTitle = removable ? proposedTitle(pending.mark) : null;
  const titleTaken = pending?.mark.fields.includes('title') ?? false;
  const offeredTitleLabel =
    offeredTitle && t('suggest.title.proposed', { title: offeredTitle.value });
  // The detail moved out of a long title rides with the offered title, in its state (R2).
  const offeredDescription = offeredTitle ? pending?.mark.suggestion?.fields.description : null;
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
  // First property alphabetically for the reader's language, so the meta line is stable
  // rather than following whatever order Firestore returns the map in.
  const [firstField] = Object.entries(note.customFields ?? {}).sort(([a], [b]) =>
    a.localeCompare(b, language),
  );
  const fieldLabel = firstField ? `${firstField[0]}: ${firstField[1]}` : undefined;
  const relatedLabel =
    relatedCount > 0 ? t('note.related.count', { count: relatedCount }) : undefined;
  const metaParts = [fieldLabel, assigneeName, checklistLabel || undefined, relatedLabel].filter(
    Boolean,
  );

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
        'paper-note-row group/row relative flex min-h-10 cursor-pointer gap-3 px-3 py-2',
        // Under review the row grows a list and a footer; its ends then sit at the top.
        reviewing ? 'items-start' : 'items-center',
        noteColourFillClass[note.colour],
        'transition-shadow duration-100',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--ring-alpha)]',
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
        // Hidden, not removed, while a change is under review: a stray click must not
        // complete a note whose proposal is still open.
        className={cn('paper-row-status shrink-0', reviewing && 'invisible')}
      />

      <div
        className={cn(
          'paper-row-body flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1',
          isDone && 'opacity-55',
        )}
      >
        <span
          className={cn(
            'paper-row-title min-w-0 text-14 font-medium text-fg-1',
            isDone && 'line-through decoration-fg-faint',
          )}
        >
          {note.title || t('common.untitled')}
        </span>

        {note.description.trim() && (
          <span className="paper-row-description text-fg-meta-on-note">{note.description}</span>
        )}

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
                  titleTaken ? 'text-fg-1' : 'text-fg-meta-on-note',
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
        {offeredDescription && (
          <span
            className={cn(
              'basis-full line-clamp-2 text-12 leading-snug',
              titleTaken ? 'text-fg-1' : 'text-fg-meta-on-note',
            )}
          >
            {offeredDescription.value}
          </span>
        )}

        {/* The same list and footer as the wall card, under the title across the row. */}
        {reviewing && (
          <span className="flex basis-full flex-col gap-1.5 pt-0.5">
            <ProposalList pending={reviewing} />
            <ReviewFooter
              mark={reviewing.mark}
              onKeep={() => reviewing.onKeep('click')}
              onUndo={reviewing.onDiscard}
            />
          </span>
        )}

        {isPrivate && <PrivateBadge className="text-fg-meta-on-note" />}

        {/* The proposed reference and steps sit where the note's own property and checklist
            count would: the note has neither while they are proposed (R7). */}
        {proposed.reference && referenceLabel && (
          <ProposedField
            className="text-12 text-fg-meta-on-note"
            name={referenceLabel}
            label={referenceLabel}
            reason={proposed.reference.reason}
            onRemove={removable ? () => pending?.onRemove('reference') : undefined}
          />
        )}
        {metaParts.length > 0 && (
          <span className="truncate text-12 text-fg-meta-on-note">{metaParts.join(' · ')}</span>
        )}
        {proposed.assignee && (
          <ProposedField
            className="text-12 text-fg-meta-on-note"
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
            className="text-12 tabular-nums text-fg-meta-on-note"
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

      <div
        className={cn('paper-row-meta flex shrink-0 items-center gap-2.5', isDone && 'opacity-55')}
      >
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
        {pending && (
          <PendingDot
            mark={pending.mark}
            onUndo={() => pending.onUndo('click')}
            // Under review the footer draws the countdown ring; the dot stays a plain marker.
            ring={!reviewing}
          />
        )}
      </div>
    </div>
  );
}
