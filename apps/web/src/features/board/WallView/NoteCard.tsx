import { useDndContext, useDraggable } from '@dnd-kit/core';
import { Check, CheckCircle2, Link2, ListChecks, Plus } from 'lucide-react';
import { useContext, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import type { NoteDto } from '@wally/shared';
import { useTranslation } from 'react-i18next';
import { useEnumLabels } from '@/i18n/enumLabels';
import { cn } from '@/lib/cn';
import { dueInfo, dueToneClass, noteColourFillClass, subtaskCountLabel } from '../util/noteDerived';
import { PriorityIcon } from '../PriorityIcon';
import { AssigneeAvatar } from '../AssigneeAvatar';
import { PrivateBadge } from '../PrivateBadge';
import { PendingDot, type DotMark } from '../Suggestions/PendingDot';
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
import { tidyKeys, type TidyProps } from '../Tidy/tidyProps';
import { CopyDragContext } from './copyDrag';
import { InlineNoteEditor } from '../Capture/InlineNoteEditor';
import { useReturnFocus, type InlineEditProps } from '../Capture/inlineEdit';
import { NoteCardQuickActions, type NoteCardActions } from './NoteCardActions';

interface NoteCardProps {
  note: NoteDto;
  currentUserId: string | undefined;
  selected: boolean;
  onOpen: () => void;
  actions?: NoteCardActions;
  style?: CSSProperties;
  /**
   * Render as the floating copy inside dnd-kit's `<DragOverlay>` rather than as a card
   * resting on the board. The overlay is the element dnd-kit translates, so this variant
   * registers no draggable and carries no animation of its own.
   */
  overlay?: boolean;
  /**
   * True while this note is the one being dragged. Comes from the board rather than
   * dnd-kit's own `isDragging`: dnd-kit clears that the instant the pointer is released,
   * in its own render pass, which un-hid the card a frame before the reposition landed.
   * The board clears this in the same commit that writes the new position.
   */
  dragging?: boolean;
  /** A change Wallybot proposed for this note, still pending or just kept (§3.3). */
  pending?: PendingProps;
  /**
   * How many notes of the board this one is related to, both ways (`relatedCounts`): the
   * board resolves it, since a deleted or private-made target leaves its id on `links` (L7)
   * and a note that is only linked to has none of its own (L1).
   */
  relatedCount?: number;
  /** The note's part in a Tidy batch, pending or just moved (RFC-0005-wallybot-inline.md §3.5). */
  tidy?: TidyProps;
  /** Editing the note's words in place; absent for a note the person may not edit. */
  edit?: InlineEditProps;
}

/**
 * A note card.
 *
 * Movement during a drag belongs to `<DragOverlay>` (see WallView), not to this component,
 * for two reasons: the board's zones are scroll containers, so a card translated in place
 * gets clipped the moment it crosses a column edge; and a note moving between zones is
 * re-parented, so React unmounts and remounts it — any mount-triggered animation here
 * would replay on every move.
 */
export function NoteCard({
  note,
  currentUserId,
  selected,
  onOpen,
  actions,
  style,
  overlay = false,
  dragging = false,
  pending,
  relatedCount = 0,
  tidy,
  edit,
}: NoteCardProps) {
  const { t, i18n } = useTranslation();
  const { priority: priorityLabels, horizon: horizonLabels } = useEnumLabels();
  const due = dueInfo(note, t);
  const checklistLabel = subtaskCountLabel(note.subtaskSummary);
  const isDone = note.status === 'DONE';
  const copying = useContext(CopyDragContext);
  // The overlay is a picture of the card in flight: it shows the note as it stands. A pending
  // change is drawn as its list (below); only a kept one shows its values in their places,
  // until the refetch carries them.
  const proposed = proposedValues(
    note,
    overlay || pending?.mark.phase !== 'kept' ? undefined : pending,
  );
  // The list and its footer: while the call runs and while the change waits for a decision.
  const reviewing =
    !overlay && pending !== undefined && pending.mark.phase !== 'kept' ? pending : undefined;
  const proposedDate = proposed.dueDate && proposedDateLabel(proposed.dueDate.value, i18n.language);
  // Only a pending change has fields to take out; a kept one shows its values plainly.
  const removable = pending?.mark.phase === 'pending';
  // The card keeps the person's own words under review: a new title and its text are offered
  // in the rows below, as every other field is.
  const shownTitle = note.title;
  const shownDescription = note.description.trim();
  const thinking = reviewing?.mark.phase === 'asking';
  // What the corner dot used to say, for a screen reader on the focused card.
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
  // Under review the moving border is the marker: no corner dot.
  const corner =
    overlay || !pending || reviewing ? null : pending.mark.phase === 'kept' ? 'undo' : 'dot';
  // A tidy's corner: the waiting dot while the batch is pending, Undo once it moved (R6, R7).
  const tidyCorner = overlay || !tidy ? null : tidy.mark.phase === 'kept' ? 'undo' : 'dot';
  const tidyLine =
    !overlay && tidy?.mark.phase === 'pending'
      ? t('tidy.moveTo', { zone: horizonLabels[tidy.mark.to] })
      : null;
  const tidyReason = tidy
    ? tidy.mark.source === 'date' && note.dueDate
      ? t('tidy.reasonDue', { date: proposedDateLabel(note.dueDate, i18n.language) })
      : (tidy.mark.reason ?? '')
    : '';

  const body = (
    <>
      {/* Not drawn while a change is under review: a stray click must not complete a note
          whose proposal is still open, and the title then lines up with the rows below it. */}
      {!reviewing && (
        <span className={cn('paper-note-status', isDone && 'paper-note-status-done')} aria-hidden>
          {isDone && <Check size={11} strokeWidth={3} />}
        </span>
      )}
      <span
        // Under review the title is where an edit starts: one click, as on the words just
        // written (the smarter-capture spec, revision "editing the text asks again").
        onClick={
          reviewing && edit && !overlay
            ? (e) => {
                e.stopPropagation();
                edit.start();
              }
            : undefined
        }
        className={cn(
          'paper-note-title line-clamp-3 text-14 font-medium leading-snug text-fg-1',
          reviewing && edit && 'cursor-text',
          isDone && 'line-through decoration-fg-faint',
          thinking && 'capture-shimmer',
          // Room for the dot, or the Undo after it, in the card's top-right corner.
          (corner === 'dot' || tidyCorner === 'dot') && 'pr-4',
          (corner === 'undo' || tidyCorner === 'undo') && 'pr-[4.5rem]',
        )}
      >
        {shownTitle || t('common.untitled')}
      </span>
      {reviewStatus && <span className="sr-only">{reviewStatus}</span>}

      {shownDescription && (
        <span
          className={cn(
            'paper-note-description -mt-1 text-12 leading-snug text-fg-meta-on-note',
            reviewing ? 'line-clamp-2' : 'line-clamp-1',
          )}
        >
          {shownDescription}
        </span>
      )}

      {/* Where the batch would move this note: the zone's own label, with the reason as the
          line's tooltip (the due date, or the model's words); the × keeps the note here (R6). */}
      {tidyLine && tidy && (
        <ProposedField
          className="-mt-1"
          name={tidyLine}
          label={<span className="text-12 font-medium leading-snug text-fg-1">{tidyLine}</span>}
          reason={tidyReason}
          removeLabel={t('tidy.remove')}
          onRemove={tidy.onRemove}
        />
      )}

      {/* A card shows no properties of its own, so the proposed reference takes a meta line
          of its own under the description. */}
      {proposed.reference && referenceLabel && (
        <ProposedField
          className="-mt-1"
          name={referenceLabel}
          label={
            <span className="line-clamp-1 break-all text-12 leading-snug text-fg-meta-on-note">
              {referenceLabel}
            </span>
          }
          reason={proposed.reference.reason}
          onRemove={removable ? () => pending?.onRemove('reference') : undefined}
        />
      )}

      {/* One line per ticked proposed link, named by the target's current title; its ×
          unticks that link alone, by the index the proposal stored (the links plan's L3). */}
      {proposed.links?.items.map((item) => {
        if (!proposed.links?.kept.includes(item.index)) return null;
        const linkLabel = t('suggest.fields.link', {
          title: item.title || t('common.untitled'),
        });
        return (
          <ProposedField
            key={item.noteId}
            className="-mt-1"
            name={linkLabel}
            label={
              <span className="line-clamp-1 text-12 leading-snug text-fg-meta-on-note">
                {linkLabel}
              </span>
            }
            reason={item.reason}
            onRemove={removable ? () => pending?.onSetLink(item.index, false) : undefined}
          />
        );
      })}

      {/* The meta line; under review every value is in the rows instead (Paper Wall v3). */}
      {!reviewing && (
        <div data-note-meta className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={cn(
              'flex items-center gap-1 whitespace-nowrap text-12 tabular-nums',
              dueToneClass[due.tone],
            )}
            style={{ fontWeight: due.weight }}
          >
            {isDone && <CheckCircle2 className="h-3 w-3 shrink-0" strokeWidth={2.2} />}
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

          {proposed.subtasks && stepsLabel ? (
            <ProposedField
              name={stepsLabel}
              label={
                <span className="flex items-center gap-1 text-12 font-medium tabular-nums text-fg-meta-on-note">
                  <ListChecks className="h-3 w-3 shrink-0" strokeWidth={1.9} />
                  {stepsLabel}
                </span>
              }
              reason={proposed.subtasks.reason}
              onRemove={removable ? () => pending?.onRemove('subtasks') : undefined}
            />
          ) : (
            checklistLabel && (
              <span className="flex items-center gap-1 text-12 font-medium tabular-nums text-fg-meta-on-note">
                <ListChecks className="h-3 w-3 shrink-0" strokeWidth={1.9} />
                {checklistLabel}
              </span>
            )
          )}

          {relatedCount > 0 && (
            <span className="flex items-center gap-1 text-12 font-medium tabular-nums text-fg-meta-on-note">
              <Link2 className="h-3 w-3 shrink-0" strokeWidth={1.9} />
              {t('note.related.count', { count: relatedCount })}
            </span>
          )}

          <span className="flex-1" />

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

          {note.visibility === 'PRIVATE' ? (
            <PrivateBadge className="text-fg-meta-on-note" />
          ) : proposed.assignee ? (
            <ProposedField
              name={t('suggest.fields.assignee', {
                name: proposed.assignee.value.displayName ?? proposed.assignee.value.email,
              })}
              label={
                <AssigneeAvatar
                  user={proposed.assignee.value}
                  isYou={proposed.assignee.value.id === currentUserId}
                />
              }
              reason={proposed.assignee.reason}
              onRemove={removable ? () => pending?.onRemove('assignee') : undefined}
            />
          ) : (
            note.assignee && (
              <AssigneeAvatar user={note.assignee} isYou={note.assignee.id === currentUserId} />
            )
          )}
        </div>
      )}
    </>
  );
  // The rows and the footer sit in the card beside its <button>, never inside it: controls
  // cannot nest in a button, and its name would take in every row and the ticking seconds.
  const review = reviewing && (
    <>
      {reviewing.mark.phase === 'pending' && <ProposalList note={note} pending={reviewing} />}
      <ReviewFooter
        mark={reviewing.mark}
        onKeep={() => reviewing.onKeep('click')}
        onUndo={reviewing.onDiscard}
        onRetry={reviewing.onRetry}
        onDismiss={reviewing.onDismiss}
      />
    </>
  );

  const surface =
    'paper-note relative flex w-[248px] select-none flex-col gap-2 overflow-hidden rounded-lg border p-3 text-left';

  if (overlay) {
    return (
      // Deliberately not `data-note-id`: that selector addresses cards on the board, and
      // during a drag the overlay would otherwise be a second element with the same id.
      <div data-note-overlay={note.id} aria-hidden className="relative">
        {copying && (
          <span className="absolute -right-2 -top-2 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-e2">
            <Plus className="h-3 w-3" strokeWidth={2.5} />
          </span>
        )}
        <div
          style={style}
          className={cn(
            surface,
            noteColourFillClass[note.colour],
            // Lifted off the board and tilted a hair, so the card reads as picked up.
            // Kept subtle: this is unwound on release, and a big tilt has further to fall.
            'border-[color:var(--note-border)] shadow-e3 rotate-[1.5deg] scale-[1.03]',
            copying ? 'cursor-copy' : 'cursor-grabbing',
            isDone && 'opacity-60 saturate-50',
          )}
        >
          {body}
        </div>
      </div>
    );
  }

  return (
    <RestingNoteCard
      note={note}
      selected={selected}
      isDone={isDone}
      dragging={dragging && !copying}
      copying={copying}
      onOpen={onOpen}
      actions={actions}
      style={style}
      surface={surface}
      body={body}
      review={review || null}
      pending={pending}
      tidy={tidy}
      edit={edit}
    />
  );
}

interface RestingProps {
  note: NoteDto;
  selected: boolean;
  isDone: boolean;
  dragging: boolean;
  copying: boolean;
  onOpen: () => void;
  actions?: NoteCardActions;
  style?: CSSProperties;
  surface: string;
  body: ReactNode;
  /** A pending change's list and footer, drawn under the card as its continuation. */
  review: ReactNode;
  pending?: PendingProps;
  tidy?: TidyProps;
  edit?: InlineEditProps;
}

/** Split out so the overlay variant above never calls `useDraggable`. */
function RestingNoteCard({
  note,
  selected,
  isDone,
  dragging,
  copying,
  onOpen,
  actions,
  style,
  surface,
  body,
  review,
  pending,
  tidy,
  edit,
}: RestingProps) {
  const { t } = useTranslation();
  const { active } = useDndContext();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: note.id });
  // A copy-drag leaves the original in place: only the copy is travelling.
  const hidden = dragging || (isDragging && !copying);
  const tidyPending = tidy?.mark.phase === 'pending';
  // A tidy waits for a yes, so its dot runs no countdown (plan R1).
  const tidyDot: DotMark | null = tidy
    ? { phase: tidy.mark.phase, countdownEndsAt: null, countdownMs: 0, paused: false }
    : null;
  const pause = usePendingPause(pending, edit?.editing ?? false);
  // An edit in place that ends (Enter, Esc) takes its field away: the keyboard goes back to the
  // card, unless the person already put it somewhere else.
  useReturnFocus(edit?.editing ?? false, () =>
    document.querySelector<HTMLElement>(
      `[data-note-id="${CSS.escape(note.id)}"] > button, [data-note-id="${CSS.escape(note.id)}"] .capture-card-button`,
    ),
  );
  const showActions = Boolean(
    actions && !note.id.startsWith('temp-') && !active && !hidden && !pending && !tidy,
  );

  const wrapperStyle: CSSProperties = {
    ...style,
    zIndex: selected ? 20 : style?.zIndex,
  };

  const keyDown = (e: KeyboardEvent<HTMLElement>) => {
    // F2 edits the words in place, as in a file list.
    if (edit && !isDragging && e.key === 'F2') {
      e.preventDefault();
      e.stopPropagation();
      edit.start();
      return;
    }
    // Enter keeps and Esc discards while a change or a tidy is pending (Esc undoes a moved
    // tidy); every other key, every key on a card with nothing pending, and every key
    // mid-drag (Esc cancels the drag, not the change) still reaches dnd-kit's keyboard sensor.
    if (!isDragging && (pendingKeys(e, pending) || tidyKeys(e, tidy))) return;
    listeners?.onKeyDown?.(e);
  };

  if (edit?.editing)
    // The words edited in place: the capture card's field where the card stood, above its
    // neighbours. It holds a waiting change's countdown while it has focus or the pointer.
    return (
      <div
        ref={setNodeRef}
        style={{ ...wrapperStyle, zIndex: 25 }}
        data-note-id={note.id}
        className="relative"
        {...pause}
      >
        <InlineNoteEditor boardId={edit.boardId} note={note} layout="card" onDone={edit.done} />
      </div>
    );

  if (review)
    // A change under review (Paper Wall v3): one card inside the moving border, holding the
    // card's own button (title and words: open, drag) and the rows and footer beside it, so
    // no control sits inside the button. The lift and the focus ring belong to the whole card.
    return (
      <div
        ref={setNodeRef}
        style={wrapperStyle}
        data-note-id={note.id}
        data-dragging={hidden || undefined}
        className="relative"
        {...pause}
      >
        <div
          data-capture-card
          className={cn(
            'capture-glow transition-transform duration-150 ease-ds',
            hidden ? 'invisible' : 'hover:-translate-y-0.5 motion-reduce:hover:translate-y-0',
          )}
        >
          <div
            className={cn(
              surface,
              'border-transparent',
              noteColourFillClass[note.colour],
              isDone && 'opacity-55 saturate-50',
            )}
          >
            <button
              type="button"
              {...listeners}
              {...attributes}
              data-pending={pending?.mark.phase}
              onClick={onOpen}
              onDoubleClick={edit?.start}
              onKeyDown={keyDown}
              className="capture-card-button flex w-full cursor-grab flex-col gap-2 text-left focus-visible:outline-none"
            >
              {body}
            </button>
            <div
              data-note-review
              onKeyDown={(e) => {
                pendingKeys(e, pending);
              }}
              className="capture-card-review flex flex-col gap-2"
            >
              {review}
            </div>
          </div>
        </div>
      </div>
    );

  return (
    <div
      ref={setNodeRef}
      style={wrapperStyle}
      data-note-id={note.id}
      data-dragging={hidden || undefined}
      className="note-card-wrapper relative"
    >
      <button
        type="button"
        {...listeners}
        {...attributes}
        data-selected={selected || undefined}
        aria-current={selected ? 'true' : undefined}
        data-pending={pending?.mark.phase}
        data-tidy={tidy?.mark.phase}
        onClick={onOpen}
        onDoubleClick={(event) => {
          // Double-clicking a card never creates a note in the containing zone: it edits the
          // card's words in place.
          event.stopPropagation();
          edit?.start();
        }}
        onKeyDown={(e) => {
          if (
            showActions &&
            !isDragging &&
            e.key.toLowerCase() === 'e' &&
            !e.metaKey &&
            !e.ctrlKey &&
            !e.altKey
          ) {
            e.preventDefault();
            e.stopPropagation();
            actions?.onExpand();
            return;
          }
          keyDown(e);
        }}
        {...pause}
        className={cn(
          surface,
          'peer/note group/note cursor-grab',
          // Hover/press easing only — never a transition on `opacity`, so picking a card
          // up hides it on the same frame the overlay appears instead of cross-fading.
          'transition-[transform,box-shadow,border-color] duration-150 ease-ds',
          // Keyboard focus is an outline, so it never fights the selection ring below.
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ring-alpha)]',
          noteColourFillClass[note.colour],
          // Selection is a 2px ink ring drawn INSIDE the card — no fill, no tint, so the note
          // keeps its own colour (docs/BRAND.md). Inset, because the zones are scroll
          // containers: an outline outside the card was clipped along the column's top edge.
          selected
            ? 'border-transparent shadow-e2'
            : 'border-[color:var(--note-border)] shadow-pin',
          // A tidy waiting for a yes: the edge goes dashed in the note's own border colour.
          tidyPending && 'border-dashed',
          // The overlay copy is what follows the cursor, so the source is hidden outright
          // rather than left behind as a ghost. `invisible` keeps its slot, so the column
          // does not reflow under the cursor mid-drag.
          hidden
            ? 'invisible'
            : 'hover:-translate-y-0.5 hover:shadow-e2 motion-reduce:hover:translate-y-0',
          isDone && 'opacity-55 saturate-50',
        )}
      >
        {body}
        {tidyDot?.phase === 'pending' && !pending && (
          <PendingDot
            mark={tidyDot}
            label={t('tidy.dotAria')}
            className="pointer-events-none absolute right-2 top-2"
          />
        )}
      </button>
      {showActions && actions && <NoteCardQuickActions actions={actions} />}
      {/* Once kept, the Undo sits where the dot was, but beside the card rather than inside
          it: a button cannot sit inside the card's own. It lifts with the card on hover. */}
      {pending?.mark.phase === 'kept' && !hidden && (
        <PendingDot
          mark={pending.mark}
          onUndo={() => pending.onUndo('click')}
          className={cn(
            'absolute right-2 top-2 transition-transform duration-150 ease-ds',
            'peer-hover/note:-translate-y-0.5 motion-reduce:peer-hover/note:translate-y-0',
          )}
        />
      )}
      {tidy && tidyDot?.phase === 'kept' && !pending && !hidden && (
        <PendingDot
          mark={tidyDot}
          onUndo={() => tidy.onUndo('click')}
          className={cn(
            'absolute right-2 top-2 transition-transform duration-150 ease-ds',
            'peer-hover/note:-translate-y-0.5 motion-reduce:peer-hover/note:translate-y-0',
          )}
        />
      )}
    </div>
  );
}
