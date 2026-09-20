import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import {
  HORIZON_LABELS,
  PRIORITY_LABELS,
  notePriorityValues,
  noteHorizonValues,
  type NoteColour,
  type NotePriority,
} from '@wally/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { IconTooltip } from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/cn';
import type { BoardAxis } from '../hooks/useBoardViewState';
import { useNoteDetail } from '../hooks/useNoteDetail';
import { useActiveMembers } from '../hooks/useMembers';
import { useUpdateNote } from '../hooks/mutations/useUpdateNote';
import { useMoveNote } from '../hooks/mutations/useMoveNote';
import { useToggleNoteStatus } from '../hooks/mutations/useToggleNoteStatus';
import { useAssignNote } from '../hooks/mutations/useAssignNote';
import { useDeleteNote } from '../hooks/mutations/useDeleteNote';
import { useAddSubtask, useRemoveSubtask, useToggleSubtask } from '../hooks/mutations/useSubtaskMutations';
import { useAddTag, useRemoveTag } from '../hooks/mutations/useTagMutations';
import { useSetCustomField, useRemoveCustomField } from '../hooks/mutations/useCustomFieldMutations';
import { collectFieldKeys, priorityToneClass } from '../util/noteDerived';
import { useNotes } from '../hooks/useNotes';
import { Field, FieldLabel, PanelSection } from './Field';
import { TagEditor } from './TagEditor';
import { SubtaskChecklist } from './SubtaskChecklist';
import { ColorSwatchPicker } from './ColorSwatchPicker';
import { HistoryTrail } from './HistoryTrail';
import { CustomFieldEditor } from './CustomFieldEditor';

const NO_ASSIGNEE = '__none__';

interface NoteDetailPanelProps {
  noteId: string | null;
  boardId: string;
  canEdit: boolean;
  axis: BoardAxis;
  isBelowDesktop: boolean;
  onClose: () => void;
}

export function NoteDetailPanel({ noteId, boardId, canEdit, axis, isBelowDesktop, onClose }: NoteDetailPanelProps) {
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
      aria-label="Notizdetails"
      /* The desktop panel used to pop into the flex row with no transition, snapping the
         board narrower in one frame. Keying the animation on the note id replays the
         slide whenever a different note is opened. */
      key={noteId}
      className="flex h-full w-[384px] shrink-0 animate-slide-in-right flex-col border-l border-border bg-card shadow-[-8px_0_24px_-12px_rgba(2,71,79,0.18)]"
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

function NoteDetailContent({ noteId, boardId, canEdit, axis, onClose, autoFocusTitle }: ContentProps) {
  const { data: note, isLoading } = useNoteDetail(noteId);
  const { activeMembers } = useActiveMembers(boardId);
  // Same cached query the board renders from — no extra fetch.
  const { data: boardNotes } = useNotes(boardId);
  const fieldKeySuggestions = useMemo(() => collectFieldKeys(boardNotes ?? []), [boardNotes]);

  const updateNote = useUpdateNote(boardId);
  const moveNote = useMoveNote(boardId);
  const toggleStatus = useToggleNoteStatus(boardId);
  const assignNote = useAssignNote(boardId);
  const deleteNote = useDeleteNote(boardId);
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
      <div className="flex flex-col gap-6 p-5" role="status" aria-label="Lädt…">
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
  const zoneLabel = axis === 'priority' ? 'Zeile' : 'Spalte';
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
    moveNote.mutate({ noteId: note!.id, input: { mode: 'PRIORITY', priority: value as NotePriority } });
  }

  function handleZoneChange(value: string) {
    if (!value || !note) return;
    if (axis === 'horizon') {
      moveNote.mutate({
        noteId: note.id,
        input: { mode: 'HORIZON', horizon: value as (typeof noteHorizonValues)[number] },
      });
    } else if (axis === 'priority') {
      moveNote.mutate({ noteId: note.id, input: { mode: 'PRIORITY', priority: value as NotePriority } });
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
      optimisticAssignee: member ? { id: value, email: member.email, displayName: member.displayName } : null,
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2.5 border-b border-border-subtle px-5 py-3">
        <span
          role="img"
          aria-label={isDone ? 'Erledigt' : `Priorität: ${PRIORITY_LABELS[note.priority]}`}
          className={cn(
            'h-2 w-2 shrink-0 rounded-full',
            isDone ? 'bg-[color:var(--status-success-bold)]' : priorityToneClass[note.priority],
          )}
        />
        <span className="flex-1 truncate text-12 font-semibold text-fg-muted">
          {isDone
            ? 'Erledigt'
            : `${axis === 'priority' ? PRIORITY_LABELS[note.priority] : HORIZON_LABELS[note.horizon]} · ${PRIORITY_LABELS[note.priority]}`}
        </span>
        <IconTooltip label="Schließen">
          <button
            type="button"
            onClick={onClose}
            aria-label="Schließen"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors duration-150 hover:bg-inset hover:text-fg-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)]"
          >
            <X className="h-4 w-4" />
          </button>
        </IconTooltip>
      </header>

      <div className="wally-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="px-5 pb-1 pt-4">
          <textarea
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onInput={resizeTitle}
            disabled={disabled}
            rows={1}
            placeholder="Was ist zu tun?"
            aria-label="Titel"
            /* Explicit `block` + `resize-none` and an auto-grown height: as a shrinkable
               flex child inside the old overflowing column this field collapsed to a few
               pixels tall. It is no longer a flex item. */
            className={cn(
              'font-head block w-full resize-none overflow-hidden rounded-md bg-transparent text-22 font-bold text-fg-1 outline-none',
              'placeholder:font-semibold placeholder:text-fg-faint',
              'disabled:cursor-not-allowed disabled:opacity-70',
              isDone && 'text-fg-muted line-through decoration-fg-faint',
            )}
          />
        </div>

        <PanelSection>
          <Field>
            <FieldLabel>Priorität</FieldLabel>
            <ToggleGroup type="single" value={note.priority} onValueChange={handlePriorityChange} disabled={disabled}>
              {notePriorityValues.map((p) => (
                <ToggleGroupItem key={p} variant="chip" value={p} aria-label={PRIORITY_LABELS[p]}>
                  <span className={cn('h-[7px] w-[7px] rounded-full', priorityToneClass[p])} />
                  {PRIORITY_LABELS[p]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>

          {showZone && (
            <Field>
              <FieldLabel>{zoneLabel}</FieldLabel>
              <ToggleGroup
                type="single"
                value={axis === 'priority' ? note.priority : note.horizon}
                onValueChange={handleZoneChange}
                disabled={disabled}
              >
                {(axis === 'priority' ? notePriorityValues : noteHorizonValues).map((key) => (
                  <ToggleGroupItem key={key} variant="chip" value={key}>
                    {axis === 'priority'
                      ? PRIORITY_LABELS[key as NotePriority]
                      : HORIZON_LABELS[key as keyof typeof HORIZON_LABELS]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Field>
          )}
        </PanelSection>

        <PanelSection>
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="note-due">Fällig</FieldLabel>
              <Input
                id="note-due"
                type="date"
                value={note.dueDate ?? ''}
                disabled={disabled}
                onChange={(e) => updateNote.mutate({ noteId: note.id, input: { dueDate: e.target.value || null } })}
                className="h-9 text-13"
              />
            </Field>
            <Field>
              <FieldLabel>Zuständig</FieldLabel>
              <Select value={note.assignee?.id ?? NO_ASSIGNEE} onValueChange={handleAssigneeChange} disabled={disabled}>
                <SelectTrigger
                  aria-label="Zuständig"
                  className="h-9 rounded-md border border-input bg-card px-3 text-13"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ASSIGNEE}>Niemand</SelectItem>
                  {activeMembers.map((member) => (
                    <SelectItem key={member.id} value={member.userId ?? member.id}>
                      {member.displayName ?? member.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
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
            onToggle={(subtaskId, done) => toggleSubtask.mutate({ noteId: note.id, subtaskId, done })}
            onRemove={(subtaskId) => removeSubtask.mutate({ noteId: note.id, subtaskId })}
          />
        </PanelSection>

        <PanelSection>
          <ColorSwatchPicker
            value={note.colour}
            disabled={disabled}
            onChange={(colour: NoteColour) => updateNote.mutate({ noteId: note.id, input: { colour } })}
          />
        </PanelSection>

        <PanelSection>
          <HistoryTrail history={note.history} />
        </PanelSection>
      </div>

      <footer className="flex shrink-0 items-center gap-3 border-t border-border px-5 py-3.5">
        <Button
          variant={isDone ? 'outline' : 'default'}
          disabled={disabled}
          onClick={() => toggleStatus.mutate({ noteId: note.id, currentStatus: note.status })}
          className="flex-1"
        >
          {isDone ? 'Wieder offen' : 'Erledigt'}
        </Button>

        {!disabled && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="icon" aria-label="Löschen">
                <Trash2 className="h-4 w-4" strokeWidth={1.9} />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Notiz löschen?</AlertDialogTitle>
                <AlertDialogDescription>
                  „{note.title || 'Ohne Titel'}“ wird endgültig gelöscht. Das kann nicht rückgängig gemacht werden.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => {
                    deleteNote.mutate(note.id);
                    onClose();
                  }}
                >
                  Löschen
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </footer>
    </div>
  );
}
