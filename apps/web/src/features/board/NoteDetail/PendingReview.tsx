import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { suggestionFieldKeys, type NoteDto, type SuggestionFieldKey } from '@wally/shared';
import { useEnumLabels } from '@/i18n/enumLabels';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  proposedDateLabel,
  proposedTitle,
  proposedValues,
  type PendingProps,
} from '../Suggestions/pendingProps';
import { displayName } from '../util/noteDerived';
import { FieldLabel, PanelSection } from './Field';

interface PendingReviewProps {
  note: NoteDto;
  pending: PendingProps;
  /**
   * A row of the person's own unticked: the panel takes that value off the note through its
   * ordinary mutation (plan R4). The row goes with the value, so `on` is only ever false.
   */
  onTypedChange: (key: SuggestionFieldKey, on: boolean) => void;
}

interface Row {
  key: string;
  label: string;
  checked: boolean;
  /** No handler: the row only says what the note holds (its title, its text). */
  onCheckedChange?: (on: boolean) => void;
}

/**
 * Every value the proposal offers, ticked into the change or not, where the note has room for
 * it: the review keeps an unticked row in place so it can be ticked back, while the card shows
 * only the ticked ones. The title is offered on its own terms (R2), through `proposedTitle`.
 */
function offeredValues(note: NoteDto, pending: PendingProps) {
  const offered = suggestionFieldKeys.filter((key) => key !== 'title');
  return proposedValues(note, { ...pending, mark: { ...pending.mark, fields: offered } });
}

/**
 * The note panel's review of a pending change, grouped by source (WALLYBOT_INLINE.md §3.4,
 * plan R3): what the person wrote and set while writing, and what the proposal adds. Ticking
 * an added row changes the change, as the card's × does; unticking a typed one changes the
 * note itself (R4). Once kept, only Undo is left.
 */
export function PendingReview({ note, pending, onTypedChange }: PendingReviewProps) {
  const { t, i18n } = useTranslation();
  const { priority: priorityLabels } = useEnumLabels();
  const id = useId();
  const { mark } = pending;
  const kept = mark.phase === 'kept';
  // A countdown paused by this panel being open still runs once it closes.
  const countsDown = mark.countdownEndsAt !== null || mark.paused;
  const status = kept
    ? t('suggest.review.kept')
    : countsDown
      ? t('suggest.review.counting')
      : t('suggest.review.waiting');
  const priorityLabel = (value: NoteDto['priority']) =>
    t('suggest.review.rowPriority', {
      label: priorityLabels[value].toLocaleLowerCase(i18n.language),
    });

  const typed: Row[] = [
    {
      key: 'title',
      label: t('suggest.review.rowTitle', { title: note.title || t('common.untitled') }),
      checked: true,
    },
  ];
  if (note.description.trim()) {
    typed.push({ key: 'text', label: t('suggest.review.rowText'), checked: true });
  }
  for (const key of mark.suggestion?.typed ?? []) {
    const untick = (on: boolean) => onTypedChange(key, on);
    // Only a value the note still holds has a row; MITTEL is the note holding no priority.
    if (key === 'dueDate' && note.dueDate) {
      const date = proposedDateLabel(note.dueDate, i18n.language);
      typed.push({
        key,
        label: t('suggest.review.rowDue', { date }),
        checked: true,
        onCheckedChange: untick,
      });
    } else if (key === 'priority' && note.priority !== 'MITTEL') {
      typed.push({
        key,
        label: priorityLabel(note.priority),
        checked: true,
        onCheckedChange: untick,
      });
    } else if (key === 'assignee' && note.assignee && note.visibility !== 'PRIVATE') {
      typed.push({
        key,
        label: t('suggest.review.rowAssignee', { name: displayName(note.assignee) }),
        checked: true,
        onCheckedChange: untick,
      });
    }
  }

  const offered = offeredValues(note, pending);
  const ticked = (key: SuggestionFieldKey) => mark.fields.includes(key);
  const setField = (key: SuggestionFieldKey) => (on: boolean) => pending.onSetField(key, on);
  const added: Row[] = [];
  const title = proposedTitle(mark);
  if (title) {
    added.push({
      key: 'title',
      label: t('suggest.title.proposed', { title: title.value }),
      checked: ticked('title'),
      onCheckedChange: setField('title'),
    });
  }
  if (offered.dueDate) {
    const date = proposedDateLabel(offered.dueDate.value, i18n.language);
    added.push({
      key: 'dueDate',
      label: t('suggest.review.rowDue', { date }),
      checked: ticked('dueDate'),
      onCheckedChange: setField('dueDate'),
    });
  }
  if (offered.priority) {
    added.push({
      key: 'priority',
      label: priorityLabel(offered.priority.value),
      checked: ticked('priority'),
      onCheckedChange: setField('priority'),
    });
  }
  if (offered.assignee) {
    added.push({
      key: 'assignee',
      label: t('suggest.review.rowAssignee', { name: displayName(offered.assignee.value) }),
      checked: ticked('assignee'),
      onCheckedChange: setField('assignee'),
    });
  }
  if (offered.reference) {
    added.push({
      key: 'reference',
      label: t('suggest.review.rowReference', {
        key: offered.reference.key,
        value: offered.reference.value,
      }),
      checked: ticked('reference'),
      onCheckedChange: setField('reference'),
    });
  }
  offered.subtasks?.items.forEach((text, index) => {
    added.push({
      key: `step-${index}`,
      label: t('suggest.review.rowStep', { text }),
      checked: ticked('subtasks') && mark.subtasks.includes(index),
      onCheckedChange: (on) => pending.onSetSubtask(index, on),
    });
  });

  return (
    <PanelSection>
      <div data-pending-review className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <FieldLabel>{t('suggest.review.label')}</FieldLabel>
          <p role="status" className="text-12 leading-snug text-fg-3">
            {status}
          </p>
        </div>

        {!kept && (
          <>
            <ReviewGroup id={`${id}-typed`} label={t('suggest.review.typed')} rows={typed} />
            {added.length > 0 && (
              <ReviewGroup id={`${id}-added`} label={t('suggest.review.added')} rows={added} />
            )}
          </>
        )}

        <div className="flex items-center gap-1.5">
          {kept ? (
            <Button variant="ghost" size="sm" onClick={pending.onUndo}>
              {t('suggest.review.undo')}
            </Button>
          ) : (
            <>
              {/* Ink, not marigold: the board's "New note" is the screen's one accent, and
                  marigold is the dot's alone here (BRAND, "Marigold has four jobs"). */}
              <Button variant="default" size="sm" onClick={pending.onKeep}>
                {t('suggest.review.keep')}
              </Button>
              <Button variant="ghost" size="sm" onClick={pending.onDiscard}>
                {t('suggest.review.discard')}
              </Button>
            </>
          )}
        </div>
      </div>
    </PanelSection>
  );
}

function ReviewGroup({ id, label, rows }: { id: string; label: string; rows: Row[] }) {
  return (
    <div role="group" aria-labelledby={`${id}-label`} className="flex flex-col gap-1.5">
      <div id={`${id}-label`}>
        <FieldLabel>{label}</FieldLabel>
      </div>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => {
          const rowId = `${id}-${row.key}`;
          return (
            <li key={row.key} className="flex min-h-7 items-center gap-2.5">
              <Checkbox
                id={rowId}
                checked={row.checked}
                disabled={!row.onCheckedChange}
                onCheckedChange={(on) => row.onCheckedChange?.(on === true)}
              />
              <label
                htmlFor={rowId}
                className="min-w-0 break-words text-13 leading-snug text-fg-1 peer-disabled:text-fg-3"
              >
                {row.label}
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
