import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Circle, CircleCheck, Trash2, X } from 'lucide-react';
import {
  notePriorityValues,
  noteHorizonValues,
  type NoteColour,
  type NoteHorizon,
  type NotePriority,
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
import type { BoardAxis } from '../hooks/useBoardViewState';
import { useNoteDetail } from '../hooks/useNoteDetail';
import { useActiveMembers } from '../hooks/useMembers';
import { useUpdateNote } from '../hooks/mutations/useUpdateNote';
import { useMoveNote } from '../hooks/mutations/useMoveNote';
import { useToggleNoteStatus } from '../hooks/mutations/useToggleNoteStatus';
import { useAssignNote } from '../hooks/mutations/useAssignNote';
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
import { collectFieldKeys } from '../util/noteDerived';
import { patchNoteCaches } from '../hooks/mutations/shared';
import { PriorityIcon } from '../PriorityIcon';
import { useNotes } from '../hooks/useNotes';
import { PanelSection, PropertyRow } from './Field';
import { TagEditor } from './TagEditor';
import { SubtaskChecklist } from './SubtaskChecklist';
import { ColorSwatchPicker } from './ColorSwatchPicker';
import { HistoryTrail } from './HistoryTrail';
import { CustomFieldEditor } from './CustomFieldEditor';

const NO_ASSIGNEE = '__none__';

/** How long typing pauses before the title is sent. The board updates on every keystroke. */
const TITLE_SAVE_DELAY_MS = 500;

/** A ToggleGroup rendered as a compact segmented control, for the properties grid. */
const SEGMENTED_GROUP = 'inline-flex flex-nowrap gap-0.5 rounded-md bg-inset p-0.5';

interface NoteDetailPanelProps {
  noteId: string | null;
  boardId: string;
  canEdit: boolean;
  axis: BoardAxis;
  isBelowDesktop: boolean;
  onClose: () => void;
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
  canEdit,
  axis,
  isBelowDesktop,
  onClose,
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
              canEdit={canEdit}
              axis={axis}
              onClose={onClose}
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
        canEdit={canEdit}
        axis={axis}
        onClose={onClose}
        autoFocusTitle
      />
    </aside>
  );
}

interface ContentProps {
  noteId: string;
  boardId: string;
  canEdit: boolean;
  axis: BoardAxis;
  onClose: () => void;
  autoFocusTitle: boolean;
}

function NoteDetailContent({
  noteId,
  boardId,
  canEdit,
  axis,
  onClose,
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
  const { deleteNote } = useDeleteNote(boardId);
  const addSubtask = useAddSubtask(boardId);
  const toggleSubtask = useToggleSubtask(boardId);
  const removeSubtask = useRemoveSubtask(boardId);
  const addTag = useAddTag(boardId);
  const removeTag = useRemoveTag(boardId);
  const setCustomField = useSetCustomField(boardId);
  const removeCustomField = useRemoveCustomField(boardId);

  const titleRef = useRef<HTMLTextAreaElement>(null);
  const [title, setTitle] = useState(note?.title ?? '');

  /** Grows the field to fit its content. The title is the one piece of text on the panel
   * that must never be clipped or scrolled. */
  const resizeTitle = useCallback(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  // Server copy -> field, but never while the user is typing in it: a refetch landing
  // mid-word would otherwise put back an older title and jump the caret.
  useEffect(() => {
    if (document.activeElement !== titleRef.current) setTitle(note?.title ?? '');
  }, [note?.id, note?.title]);

  /*
   * The title saves as you type. Every keystroke patches the cached note so the card on the
   * board changes instantly; the request itself is debounced, and flushed on blur, Enter,
   * and when the panel closes or switches note.
   */
  const queryClient = useQueryClient();
  const { mutate: mutateNote } = updateNote;
  const lastSavedTitle = useRef(note?.title ?? '');
  const pendingTitle = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (note && pendingTitle.current === null) lastSavedTitle.current = note.title;
  }, [note]);

  const flushTitle = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const value = pendingTitle.current;
    pendingTitle.current = null;
    if (value === null || value === lastSavedTitle.current) return;
    lastSavedTitle.current = value;
    mutateNote({ noteId, input: { title: value } });
  }, [mutateNote, noteId]);

  // Closing the panel or switching note unmounts this content: send what was typed.
  useEffect(() => flushTitle, [flushTitle]);

  function handleTitleChange(value: string) {
    setTitle(value);
    const trimmed = value.trim();
    // An empty title is never saved; leaving the field puts the last one back.
    if (!trimmed) return;
    patchNoteCaches(queryClient, boardId, noteId, { title: trimmed });
    pendingTitle.current = trimmed;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushTitle, TITLE_SAVE_DELAY_MS);
  }

  function handleTitleBlur() {
    flushTitle();
    if (!title.trim()) setTitle(lastSavedTitle.current);
  }

  useEffect(() => {
    resizeTitle();
  }, [title, resizeTitle]);

  const noteReady = Boolean(note);
  useEffect(() => {
    if (autoFocusTitle && noteReady && titleRef.current) {
      // preventScroll: focusing must never scroll the board behind the panel.
      titleRef.current.focus({ preventScroll: true });
      titleRef.current.selectionStart = titleRef.current.value.length;
    }
    // Re-run once the note finishes loading (noteReady flips false -> true), but not on
    // every subsequent title keystroke — that's why this depends on the boolean
    // `noteReady`, not `note` itself.
  }, [noteId, autoFocusTitle, noteReady]);

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

  const disabled = !canEdit;
  // Only the horizon axis needs its own zone control: in the priority axis the zone IS the
  // priority, and the Priority row above already moves it.
  const showZone = axis === 'horizon';
  const isDone = note.status === 'DONE';

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
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            onBlur={handleTitleBlur}
            onKeyDown={(e) => {
              // One line of meaning, even when it wraps: Enter finishes the title.
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            onInput={resizeTitle}
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

          <PropertyRow label={t('note.assigneeLabel')}>
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
                {activeMembers.map((member) => (
                  <SelectItem key={member.id} value={member.userId ?? member.id}>
                    {member.displayName ?? member.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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

      {/* Delete is the only footer action. No confirmation dialog: the note goes at once
          and a toast offers Undo, which is both faster and safer than "Are you sure?". */}
      {!disabled && (
        <footer className="flex shrink-0 items-center border-t border-border-subtle px-3 py-2">
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
