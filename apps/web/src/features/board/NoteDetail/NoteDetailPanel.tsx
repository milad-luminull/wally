import { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Circle, CircleCheck, Copy, Trash2, X } from 'lucide-react';
import {
  notePriorityValues,
  noteHorizonValues,
  type NoteColour,
  type NoteHorizon,
  type NotePriority,
  type UserSummary,
} from '@wally/shared';
import { useEnumLabels } from '@/i18n/enumLabels';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { IconTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { MOD_KEY } from '@/lib/shortcuts';
import type { BoardAxis } from '../hooks/useBoardViewState';
import { useNoteDetail } from '../hooks/useNoteDetail';
import { useActiveMembers } from '../hooks/useMembers';
import { useUpdateNote } from '../hooks/mutations/useUpdateNote';
import { useMoveNote } from '../hooks/mutations/useMoveNote';
import { useToggleNoteStatus } from '../hooks/mutations/useToggleNoteStatus';
import { useAssignNote } from '../hooks/mutations/useAssignNote';
import { useSetNoteVisibility } from '../hooks/mutations/useSetNoteVisibility';
import { useDeleteNote } from '../hooks/mutations/useDeleteNote';
import {
  useAddSubtask,
  useRemoveSubtask,
  useToggleSubtask,
} from '../hooks/mutations/useSubtaskMutations';
import { useAddTag, useRemoveTag } from '../hooks/mutations/useTagMutations';
import {
  useSetCustomField,
  useRemoveCustomField,
} from '../hooks/mutations/useCustomFieldMutations';
import { collectFieldKeys, displayName } from '../util/noteDerived';
import type { BoardAccess } from '../util/permissions';
import { captureMutation, type MutationTicket } from '@/lib/mutationQueue';
import { PriorityIcon } from '../PriorityIcon';
import { AssigneeAvatar } from '../AssigneeAvatar';
import { useNotes } from '../hooks/useNotes';
import { PanelSection, PropertyRow } from './Field';
import { TagEditor } from './TagEditor';
import { SubtaskChecklist } from './SubtaskChecklist';
import { ColorSwatchPicker } from './ColorSwatchPicker';
import { HistoryTrail } from './HistoryTrail';
import { CustomFieldEditor } from './CustomFieldEditor';
import { VisibilityRow } from './VisibilityRow';
import { useLiveNoteText } from './useLiveNoteText';

const NO_ASSIGNEE = '__none__';

/** An empty title is never saved; leaving the field puts the last one back. */
const normalizeTitle = (raw: string) => raw.trim() || null;
/** A description may be cleared; one that is only whitespace counts as cleared. */
const normalizeDescription = (raw: string) => (raw.trim() ? raw : '');

/** A ToggleGroup rendered as a compact segmented control, for the properties grid. */
const SEGMENTED_GROUP = 'inline-flex flex-nowrap gap-0.5 rounded-md bg-inset p-0.5';

interface NoteDetailPanelProps {
  noteId: string | null;
  boardId: string;
  access: BoardAccess;
  axis: BoardAxis;
  isBelowDesktop: boolean;
  onClose: () => void;
  onDuplicate: (noteId: string) => void;
  currentUserId: string | undefined;
}

/**
 * Escape closes the desktop panel.
 *
 * The mobile sheet gets this free from Radix; the desktop `<aside>` is a plain element, so
 * until now the panel had exactly one exit — a 28px X in the corner. That is half of why
 * people reached for the footer button instead.
 *
 * It defers to any layer above it: Radix renders selects and popovers into a popper wrapper
 * and the delete confirmation as an alertdialog, and each closes itself on Escape. Without
 * this guard, dismissing the assignee dropdown — or backing out of the delete dialog — would
 * take the whole panel with it.
 */
function useEscapeToClose(onClose: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const layerAbove = document.querySelector(
        '[data-radix-popper-content-wrapper], [role="alertdialog"], [role="dialog"]',
      );
      if (layerAbove) return;
      onClose();
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [enabled, onClose]);
}

export function NoteDetailPanel({
  noteId,
  boardId,
  access,
  axis,
  isBelowDesktop,
  onClose,
  onDuplicate,
  currentUserId,
}: NoteDetailPanelProps) {
  const { t } = useTranslation();
  useEscapeToClose(onClose, !isBelowDesktop && Boolean(noteId));

  if (isBelowDesktop) {
    return (
      <Sheet open={Boolean(noteId)} onOpenChange={(open) => !open && onClose()}>
        <SheetContent side="right" className="w-full max-w-sm p-0" hideClose>
          {noteId && (
            <NoteDetailContent
              noteId={noteId}
              boardId={boardId}
              access={access}
              axis={axis}
              onClose={onClose}
              onDuplicate={onDuplicate}
              currentUserId={currentUserId}
              autoFocusTitle={false}
            />
          )}
        </SheetContent>
      </Sheet>
    );
  }

  if (!noteId) return null;

  return (
    <aside
      role="complementary"
      aria-label={t('note.panelAria')}
      /* Floats over the board's right edge instead of taking a slot in the row. As a flex
         child it narrowed the board, so the centred columns jumped sideways every time a
         note opened or closed. It slides in once, on open; switching to another note swaps
         the content in place (the key is on the content, not on this element). */
      className="absolute inset-y-0 right-0 z-drawer flex w-[400px] max-w-full animate-slide-in-right flex-col border-l border-border bg-surface shadow-e3"
    >
      <NoteDetailContent
        key={noteId}
        noteId={noteId}
        boardId={boardId}
        access={access}
        axis={axis}
        onClose={onClose}
        onDuplicate={onDuplicate}
        currentUserId={currentUserId}
        autoFocusTitle
      />
    </aside>
  );
}

interface ContentProps {
  noteId: string;
  boardId: string;
  access: BoardAccess;
  axis: BoardAxis;
  onClose: () => void;
  onDuplicate: (noteId: string) => void;
  currentUserId: string | undefined;
  autoFocusTitle: boolean;
}

function NoteDetailContent({
  noteId,
  boardId,
  access,
  axis,
  onClose,
  onDuplicate,
  currentUserId,
  autoFocusTitle,
}: ContentProps) {
  const { t } = useTranslation();
  const { priority: priorityLabels, horizon: horizonLabels } = useEnumLabels();
  const { data: note, isLoading } = useNoteDetail(noteId);
  const { activeMembers } = useActiveMembers(boardId);
  // Same cached query the board renders from — no extra fetch.
  const { data: boardNotes } = useNotes(boardId);
  const fieldKeySuggestions = useMemo(() => collectFieldKeys(boardNotes ?? []), [boardNotes]);

  const updateNote = useUpdateNote(boardId);
  const moveNote = useMoveNote(boardId);
  const toggleStatus = useToggleNoteStatus(boardId);
  const assignNote = useAssignNote(boardId);
  const setVisibility = useSetNoteVisibility(boardId);
  const { deleteNote } = useDeleteNote(boardId);
  const addSubtask = useAddSubtask(boardId);
  const toggleSubtask = useToggleSubtask(boardId);
  const removeSubtask = useRemoveSubtask(boardId);
  const addTag = useAddTag(boardId);
  const removeTag = useRemoveTag(boardId);
  const setCustomField = useSetCustomField(boardId);
  const removeCustomField = useRemoveCustomField(boardId);

  /*
   * Title and description save as you type: see useLiveNoteText. Both patch the cached
   * note on every keystroke, so the card on the board follows along.
   */
  const { mutateAsync: mutateNote } = updateNote;
  const saveTitle = useCallback(
    (title: string, ticket?: MutationTicket) => mutateNote({ noteId, input: { title }, ticket }),
    [mutateNote, noteId],
  );
  const saveDescription = useCallback(
    (description: string, ticket?: MutationTicket) =>
      mutateNote({ noteId, input: { description }, ticket }),
    [mutateNote, noteId],
  );
  const title = useLiveNoteText({
    serverValue: note?.title ?? '',
    normalize: normalizeTitle,
    onLocalChange: () => {},
    draftKey: `${noteId}:title`,
    capture: () => captureMutation(`note:${noteId}`, { revision: note?.revision }),
    save: saveTitle,
  });
  const description = useLiveNoteText({
    serverValue: note?.description ?? '',
    normalize: normalizeDescription,
    onLocalChange: () => {},
    draftKey: `${noteId}:description`,
    capture: () => captureMutation(`note:${noteId}`, { revision: note?.revision }),
    save: saveDescription,
  });
  const titleRef = title.ref;

  const noteReady = Boolean(note);
  useEffect(() => {
    if (autoFocusTitle && noteReady && titleRef.current) {
      // preventScroll: focusing must never scroll the board behind the panel.
      titleRef.current.focus({ preventScroll: true });
      titleRef.current.selectionStart = titleRef.current.value.length;
    }
    // Re-run once the note finishes loading (noteReady flips false -> true), but not on
    // every subsequent title keystroke — that's why this depends on the boolean
    // `noteReady`, not `note` itself. `titleRef` is a ref object and never changes.
  }, [noteId, autoFocusTitle, noteReady, titleRef]);

  if (isLoading || !note) {
    return (
      <div className="flex flex-col gap-6 p-5" role="status" aria-label={t('common.loading')}>
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-7 w-7 rounded-md" />
        </div>
        <Skeleton className="h-7 w-3/4" />
        <div className="flex flex-col gap-3">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-8 w-full" />
        </div>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-8 w-full" />
        </div>
      </div>
    );
  }

  const disabled = !access.canEditNote(note);
  // Active members, plus the current assignee if they are not among them (a pending or
  // since-removed member) — otherwise the trigger has no item to show and goes blank.
  const assigneeOptions: UserSummary[] = activeMembers.map((m) => ({
    id: m.userId ?? m.id,
    email: m.email,
    displayName: m.displayName,
  }));
  if (note.assignee && !assigneeOptions.some((o) => o.id === note.assignee!.id)) {
    assigneeOptions.push(note.assignee);
  }
  // Only the horizon axis needs its own zone control: in the priority axis the zone IS the
  // priority, and the Priority row above already moves it.
  const showZone = axis === 'horizon';
  const isDone = note.status === 'DONE';
  const isPrivate = note.visibility === 'PRIVATE';

  function handlePriorityChange(value: string) {
    if (!value) return;
    moveNote.mutate({
      noteId: note!.id,
      input: { mode: 'PRIORITY', priority: value as NotePriority },
    });
  }

  function handleZoneChange(value: string) {
    if (!value || !note) return;
    moveNote.mutate({ noteId: note.id, input: { mode: 'HORIZON', horizon: value as NoteHorizon } });
  }

  function handleAssigneeChange(value: string) {
    if (!note) return;
    if (value === NO_ASSIGNEE) {
      assignNote.mutate({ noteId: note.id, assigneeId: null, optimisticAssignee: null });
      return;
    }
    const member = activeMembers.find((m) => m.userId === value);
    assignNote.mutate({
      noteId: note.id,
      assigneeId: value,
      optimisticAssignee: member
        ? { id: value, email: member.email, displayName: member.displayName }
        : null,
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Completion leads the panel, as a toggle that says what it does. It is a checkbox
          (role and state), never a footer button: a filled "Done" in the bottom confirm
          slot read as "dismiss this panel", and people completed to-dos trying to close. */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border-subtle pl-3.5 pr-2.5">
        <button
          type="button"
          role="checkbox"
          aria-checked={isDone}
          aria-label={t('note.doneStatus')}
          disabled={disabled}
          onClick={() => toggleStatus.mutate({ noteId: note.id, currentStatus: note.status })}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-12 font-medium',
            'transition-[background-color,border-color,color] duration-150 ease-ds',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)]',
            'disabled:cursor-not-allowed disabled:opacity-50 [@media(pointer:coarse)]:h-10',
            '[&_svg]:size-4',
            isDone
              ? 'border-primary bg-primary text-primary-foreground hover:bg-primary-hover'
              : 'border-border bg-surface text-fg-2 hover:border-border-strong hover:text-fg-1',
          )}
        >
          {isDone ? <CircleCheck strokeWidth={2} /> : <Circle strokeWidth={1.75} />}
          <span aria-hidden>{isDone ? t('note.doneStatus') : t('board.rowStatus.markDone')}</span>
        </button>
        <span className="flex-1" />
        <IconTooltip label={t('common.close')} shortcut={['Esc']}>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t('common.close')}>
            <X strokeWidth={1.75} />
          </Button>
        </IconTooltip>
      </header>

      <div className="wally-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="px-5 pb-4 pt-5">
          <textarea
            ref={titleRef}
            value={title.value}
            onChange={(e) => title.onChange(e.target.value)}
            onBlur={title.onBlur}
            onKeyDown={(e) => {
              // One line of meaning, even when it wraps: Enter finishes the title.
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            onInput={title.resize}
            disabled={disabled}
            rows={1}
            placeholder={t('note.titlePlaceholder')}
            aria-label={t('note.titleAria')}
            /* Explicit `block` + `resize-none` and an auto-grown height: as a shrinkable
               flex child inside the old overflowing column this field collapsed to a few
               pixels tall. It is no longer a flex item. */
            className={cn(
              'block w-full resize-none overflow-hidden rounded-md bg-transparent text-20 font-semibold text-fg-1 outline-none',
              'placeholder:text-fg-faint',
              'disabled:cursor-not-allowed disabled:opacity-70',
              isDone && 'text-fg-3 line-through decoration-fg-faint',
            )}
          />
          {/* Deliberately bare: no label, no border, no toolbar — it reads as the line under
              the title until you write in it. Enter is a new line here, unlike the title. */}
          <textarea
            ref={description.ref}
            value={description.value}
            onChange={(e) => description.onChange(e.target.value)}
            onBlur={description.onBlur}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                // Leave the field, not the panel: the first Escape only ends the edit.
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            onInput={description.resize}
            disabled={disabled}
            rows={1}
            placeholder={disabled ? undefined : t('note.descriptionPlaceholder')}
            aria-label={t('note.descriptionAria')}
            className={cn(
              'mt-1 block w-full resize-none overflow-hidden rounded-md bg-transparent text-14 leading-relaxed text-fg-2 outline-none',
              'placeholder:text-fg-faint',
              'disabled:cursor-not-allowed disabled:opacity-70',
              disabled && !description.value && 'hidden',
            )}
          />
        </div>

        <PanelSection>
          <SubtaskChecklist
            subtasks={note.subtasks}
            disabled={disabled}
            onAdd={(text) => addSubtask.mutate({ noteId: note.id, text })}
            onToggle={(subtaskId, done) =>
              toggleSubtask.mutate({ noteId: note.id, subtaskId, done })
            }
            onRemove={(subtaskId) => removeSubtask.mutate({ noteId: note.id, subtaskId })}
          />
        </PanelSection>

        <PanelSection>
          <PropertyRow label={t('note.priorityLabel')}>
            <ToggleGroup
              type="single"
              variant="segment"
              size="sm"
              value={note.priority}
              onValueChange={handlePriorityChange}
              disabled={disabled}
              className={SEGMENTED_GROUP}
            >
              {notePriorityValues.map((p) => (
                <ToggleGroupItem key={p} value={p} aria-label={priorityLabels[p]}>
                  <PriorityIcon priority={p} size={12} />
                  {priorityLabels[p]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </PropertyRow>

          {showZone && (
            <PropertyRow label={t('note.zone.column')}>
              <ToggleGroup
                type="single"
                variant="segment"
                size="sm"
                value={note.horizon}
                onValueChange={handleZoneChange}
                disabled={disabled}
                className={SEGMENTED_GROUP}
              >
                {noteHorizonValues.map((key) => (
                  <ToggleGroupItem key={key} value={key}>
                    {horizonLabels[key]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </PropertyRow>
          )}

          <PropertyRow label={t('note.dueLabel')} htmlFor="note-due">
            <Input
              id="note-due"
              type="date"
              value={note.dueDate ?? ''}
              disabled={disabled}
              onChange={(e) =>
                updateNote.mutate({ noteId: note.id, input: { dueDate: e.target.value || null } })
              }
              className="h-7 w-auto shadow-none [@media(pointer:coarse)]:h-10"
            />
          </PropertyRow>

          {access.showsVisibilitySwitch(note) && (
            <VisibilityRow
              visibility={note.visibility}
              canChange={access.canEditShared}
              onChange={(visibility) =>
                setVisibility.mutate({ noteId: note.id, visibility, creator: note.createdBy })
              }
            />
          )}

          <PropertyRow label={t('note.assigneeLabel')}>
            {isPrivate ? (
              // Only its creator ever opens a private note, and it is always theirs: "You".
              <span className="flex min-w-0 items-center gap-2">
                {note.assignee && <AssigneeAvatar user={note.assignee} isYou size="sm" />}
                <span className="shrink-0 text-13 text-fg-1">{t('common.you')}</span>
                <span className="truncate text-12 text-fg-3">
                  {t('note.private.assigneeLocked')}
                </span>
              </span>
            ) : (
              <Select
                value={note.assignee?.id ?? NO_ASSIGNEE}
                onValueChange={handleAssigneeChange}
                disabled={disabled}
              >
                <SelectTrigger
                  aria-label={t('note.assigneeLabel')}
                  className="h-7 w-auto min-w-[140px] max-w-full shadow-none [@media(pointer:coarse)]:h-10"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ASSIGNEE}>{t('note.noAssignee')}</SelectItem>
                  {assigneeOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      <span className="flex items-center gap-2">
                        <AssigneeAvatar
                          user={option}
                          isYou={option.id === currentUserId}
                          size="sm"
                        />
                        {option.id === currentUserId
                          ? t('note.youSuffix', { name: displayName(option) })
                          : displayName(option)}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </PropertyRow>

          <PropertyRow label={t('note.colourLabel')}>
            <ColorSwatchPicker
              value={note.colour}
              disabled={disabled}
              onChange={(colour: NoteColour) =>
                updateNote.mutate({ noteId: note.id, input: { colour } })
              }
            />
          </PropertyRow>
        </PanelSection>

        <PanelSection>
          <CustomFieldEditor
            fields={note.customFields}
            keySuggestions={fieldKeySuggestions}
            disabled={disabled}
            onSet={(key, value) => setCustomField.mutate({ noteId: note.id, key, value })}
            onRemove={(key) => removeCustomField.mutate({ noteId: note.id, key })}
          />

          <TagEditor
            tags={note.tags}
            disabled={disabled}
            onAdd={(tag) => addTag.mutate({ noteId: note.id, tag })}
            onRemove={(tag) => removeTag.mutate({ noteId: note.id, tag })}
          />
        </PanelSection>

        <PanelSection>
          <HistoryTrail history={note.history} />
        </PanelSection>
      </div>

      {/* No confirmation dialog for Delete: the note goes at once and a toast offers Undo,
          which is both faster and safer than "Are you sure?". Duplicate sits beside it and
          opens the copy straight away, the same as ⌘D. */}
      {!disabled && (
        <footer className="flex shrink-0 items-center justify-between border-t border-border-subtle px-3 py-2">
          <IconTooltip label={t('note.duplicate')} shortcut={[MOD_KEY, 'D']}>
            <Button variant="ghost" size="sm" onClick={() => onDuplicate(note.id)}>
              <Copy strokeWidth={1.75} />
              {t('note.duplicate')}
            </Button>
          </IconTooltip>
          <Button
            variant="destructive-ghost"
            size="sm"
            onClick={() => {
              deleteNote(note.id);
              onClose();
            }}
          >
            <Trash2 strokeWidth={1.75} />
            {t('common.delete')}
          </Button>
        </footer>
      )}
    </div>
  );
}
