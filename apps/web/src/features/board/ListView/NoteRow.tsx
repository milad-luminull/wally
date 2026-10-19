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
  proposedValues,
  type PendingProps,
} from '../Suggestions/pendingProps';
import { usePendingPause } from '../Suggestions/usePendingPause';
import { InlineNoteEditor } from '../Capture/InlineNoteEditor';
import { useReturnFocus, type InlineEditProps } from '../Capture/inlineEdit';

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
  /** Editing the note's words in place; absent for a note the person may not edit. */
  edit?: InlineEditProps;
}

export function NoteRow({
  note,
  currentUserId,
  onOpen,
  onToggleDone,
  canEdit,
  pending,
  relatedCount = 0,
  edit,
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
  // Only a pending change has fields to take out; a kept one shows its values plainly.
  const removable = pending?.mark.phase === 'pending';
  // The row keeps the person's own words under review: a new title and its text are offered
  // in the rows below, as every other field is.
  const shownTitle = note.title;
  const shownDescription = note.description.trim();
  const thinking = reviewing?.mark.phase === 'asking';
  // What the dot used to say, for a screen reader on the focused row.
  const reviewStatus =
    reviewing?.mark.phase === 'pending'
      ? t(
          reviewing.mark.countdownEndsAt !== null || reviewing.mark.paused
            ? 'suggest.dotAria'
            : 'suggest.dotAriaWaiting',
        )
      : null;
  const referenceLabel =
    proposed.reference &&
    t('suggest.fields.reference', {
      key: proposed.reference.key,
      value: proposed.reference.value,
    });
  const stepsLabel =
    proposed.subtasks && t('suggest.fields.subtasks', { count: proposed.subtasks.kept.length });
  const pause = usePendingPause(pending, edit?.editing ?? false);
  // An edit in place that ends (Enter, Esc) takes its field away: the keyboard goes back to the
  // row, unless the person already put it somewhere else.
  useReturnFocus(edit?.editing ?? false, () =>
    document.querySelector<HTMLElement>(`[data-note-id="${CSS.escape(note.id)}"][role="button"]`),
  );

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

  const row = (
    <div
      role="button"
      tabIndex={0}
      // The same address the wall's cards carry, so the board can focus the row after a
      // commit (useCaptureSession) and Enter keeps from there.
      data-note-id={note.id}
      data-pending={pending?.mark.phase}
      onClick={onOpen}
      onDoubleClick={edit?.start}
      onKeyDown={(e) => {
        // F2 edits the words in place, as in a file list.
        if (edit && e.key === 'F2' && e.target === e.currentTarget) {
          e.preventDefault();
          e.stopPropagation();
          edit.start();
          return;
        }
        // Enter keeps and Esc discards while a change is pending, instead of opening.
        if (pendingKeys(e, pending)) return;
        // A key meant for a control inside the row (the checkbox, the Undo) is not "open".
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      // Under review the shell around the row and its review holds the pause instead.
      {...(reviewing ? {} : pause)}
      className={cn(
        'paper-note-row group/row relative flex min-h-10 cursor-pointer gap-3 px-3 py-2',
        // Under review the row grows a list and a footer; its ends then sit at the top.
        reviewing ? 'items-start' : 'items-center',
        noteColourFillClass[note.colour],
        'transition-shadow duration-100',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--ring-alpha)]',
        '[@media(pointer:coarse)]:min-h-12',
      )}
    >
      {/* Not drawn while a change is under review: a stray click must not complete a note
          whose proposal is still open, and the title then lines up with the rows below it. */}
      {!reviewing && (
        <Checkbox
          checked={isDone}
          onClick={handleCheckboxClick}
          disabled={!canEdit}
          aria-label={isDone ? t('board.rowStatus.markOpen') : t('board.rowStatus.markDone')}
          className="paper-row-status shrink-0"
        />
      )}

      <div
        className={cn(
          'paper-row-body flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1',
          isDone && 'opacity-55',
        )}
      >
        <span
          // Under review the title is where an edit starts: one click, as on the words just
          // written (the smarter-capture spec, revision "editing the text asks again").
          onClick={
            reviewing && edit
              ? (e) => {
                  e.stopPropagation();
                  edit.start();
                }
              : undefined
          }
          className={cn(
            'paper-row-title min-w-0 text-14 font-medium text-fg-1',
            reviewing && edit && 'cursor-text',
            isDone && 'line-through decoration-fg-faint',
            thinking && 'capture-shimmer',
          )}
        >
          {shownTitle || t('common.untitled')}
        </span>
        {reviewStatus && <span className="sr-only">{reviewStatus}</span>}

        {shownDescription && (
          <span className="paper-row-description text-fg-meta-on-note">{shownDescription}</span>
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

      {/* Under review every value is in the rows instead (Paper Wall v3). */}
      {!reviewing && (
        <div
          className={cn(
            'paper-row-meta flex shrink-0 items-center gap-2.5',
            isDone && 'opacity-55',
          )}
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
          {pending && <PendingDot mark={pending.mark} onUndo={() => pending.onUndo('click')} />}
        </div>
      )}
    </div>
  );
  if (edit?.editing)
    // The words edited in place: the capture row's field where the row stood. It holds a
    // waiting change's countdown while it has focus or the pointer.
    return (
      <div data-note-id={note.id} {...pause}>
        <InlineNoteEditor boardId={edit.boardId} note={note} layout="row" onDone={edit.done} />
      </div>
    );
  if (!reviewing) return row;
  // The same card as on the wall (Paper Wall v3): inside the moving border, the row's own
  // button and, beside it, the rows and the footer; nothing nests in the button role.
  return (
    <div data-capture-card className="capture-glow" {...pause}>
      <div className={cn('capture-row-card', noteColourFillClass[note.colour])}>
        {row}
        <div
          data-note-review
          onKeyDown={(e) => {
            pendingKeys(e, reviewing);
          }}
          className="capture-row-review"
        >
          {reviewing.mark.phase === 'pending' && <ProposalList note={note} pending={reviewing} />}
          <ReviewFooter
            mark={reviewing.mark}
            onKeep={() => reviewing.onKeep('click')}
            onUndo={reviewing.onDiscard}
          />
        </div>
      </div>
    </div>
  );
}
