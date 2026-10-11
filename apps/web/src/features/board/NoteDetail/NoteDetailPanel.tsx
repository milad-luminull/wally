import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, X } from 'lucide-react';
import {
  notePriorityValues,
  noteHorizonValues,
  type NoteColour,
  type NoteHorizon,
  type NotePriority,
} from '@wally/shared';
import { useEnumLabels } from '@/i18n/enumLabels';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { collectFieldKeys, noteColourFillClass } from '../util/noteDerived';
import { PriorityDot } from '../PriorityDot';
import { useNotes } from '../hooks/useNotes';
import { PanelSection, PropertyRow } from './Field';
import { TagEditor } from './TagEditor';
import { SubtaskChecklist } from './SubtaskChecklist';
import { ColorSwatchPicker } from './ColorSwatchPicker';
import { HistoryTrail } from './HistoryTrail';
import { CustomFieldEditor } from './CustomFieldEditor';

const NO_ASSIGNEE = '__none__';

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
      /* The desktop panel used to pop into the flex row with no transition, snapping the
         board narrower in one frame. Keying the animation on the note id replays the
         slide whenever a different note is opened. */
      key={noteId}
      className="flex h-full w-[400px] shrink-0 animate-slide-in-right flex-col border-l border-border bg-surface"
    >
      <NoteDetailContent
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

  useEffect(() => {
    setTitle(note?.title ?? '');
  }, [note?.id, note?.title]);

  useEffect(() => {
    resizeTitle();
  }, [title, resizeTitle]);

  const noteReady = Boolean(note);
  useEffect(() => {
    if (autoFocusTitle && noteReady && titleRef.current) {
      titleRef.current.focus();
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
  const zoneLabel = t(axis === 'priority' ? 'note.zone.row' : 'note.zone.column');
  const showZone = axis !== 'free';
  const isDone = note.status === 'DONE';

  function commitTitle() {
    const trimmed = title.trim();
    if (!note || trimmed === note.title || !trimmed) {
      setTitle(note?.title ?? '');
      return;
    }
    updateNote.mutate({ noteId: note.id, input: { title: trimmed } });
  }

  function handlePriorityChange(value: string) {
    if (!value) return;
    moveNote.mutate({
      noteId: note!.id,
      input: { mode: 'PRIORITY', priority: value as NotePriority },
    });
  }

  function handleZoneChange(value: string) {
    if (!value || !note) return;
    if (axis === 'horizon') {
      moveNote.mutate({
        noteId: note.id,
        input: { mode: 'HORIZON', horizon: value as (typeof noteHorizonValues)[number] },
      });
    } else if (axis === 'priority') {
      moveNote.mutate({
        noteId: note.id,
        input: { mode: 'PRIORITY', priority: value as NotePriority },
      });
    }
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
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border-subtle pl-5 pr-2.5">
        {/* Decorative only: the breadcrumb beside it already names the zone, the priority
            and the done state in words, so marking the swatch too would announce them twice. */}
        <span
          aria-hidden
          className={cn(
            'h-3 w-3 shrink-0 rounded-[3px] border border-[color:var(--note-border)]',
            noteColourFillClass[note.colour],
          )}
        />
        <span className="flex-1 truncate text-12 font-medium text-fg-3">
          {isDone
            ? t('note.doneStatus')
            : `${axis === 'priority' ? priorityLabels[note.priority] : horizonLabels[note.horizon]} · ${priorityLabels[note.priority]}`}
        </span>
        <IconTooltip label={t('common.close')} shortcut={['Esc']}>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t('common.close')}>
            <X strokeWidth={1.75} />
          </Button>
        </IconTooltip>
      </header>

      <div className="wally-scroll min-h-0 flex-1 overflow-y-auto">
        {/* Completion is a checkbox, not a footer button. A filled button in the bottom
            confirm slot labelled "Erledigt" reads as "dismiss this panel" — which is what
            people pressed it for, silently completing their to-do instead of closing. The
            panel auto-saves every field, so it has nothing to confirm and needs no such
            button. This also matches how the list view has always completed a note. */}
        <div className="flex items-center gap-2.5 px-5 pb-0.5 pt-5">
          <Checkbox
            id="note-done"
            checked={isDone}
            disabled={disabled}
            onCheckedChange={() =>
              toggleStatus.mutate({ noteId: note.id, currentStatus: note.status })
            }
          />
          {/* Quieter than the title, but deliberately not as quiet as a field label: this is
              the note's one state control, and it has to read as interactive. The generous
              vertical padding is the touch target — the box itself is 16px. */}
          <label
            htmlFor="note-done"
            className={cn(
              '-my-1.5 py-1.5 text-13 font-medium text-fg-2 select-none',
              !disabled && 'cursor-pointer hover:text-fg-1',
            )}
          >
            {t('note.doneStatus')}
          </label>
        </div>

        <div className="px-5 pb-3 pt-2">
          <textarea
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
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
                  <PriorityDot priority={p} />
                  {priorityLabels[p]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </PropertyRow>

          {showZone && (
            <PropertyRow label={zoneLabel}>
              <ToggleGroup
                type="single"
                variant="segment"
                size="sm"
                value={axis === 'priority' ? note.priority : note.horizon}
                onValueChange={handleZoneChange}
                disabled={disabled}
                className={SEGMENTED_GROUP}
              >
                {(axis === 'priority' ? notePriorityValues : noteHorizonValues).map((key) => (
                  <ToggleGroupItem key={key} value={key}>
                    {axis === 'priority'
                      ? priorityLabels[key as NotePriority]
                      : horizonLabels[key as NoteHorizon]}
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
