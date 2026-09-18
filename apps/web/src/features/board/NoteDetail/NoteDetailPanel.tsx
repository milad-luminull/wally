import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
  HORIZON_LABELS,
  PRIORITY_LABELS,
  notePriorityValues,
  noteHorizonValues,
  type NoteColour,
  type NotePriority,
} from '@wally/shared';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
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
import { priorityToneClass } from '../util/noteDerived';
import { TagEditor } from './TagEditor';
import { SubtaskChecklist } from './SubtaskChecklist';
import { ColorSwatchPicker } from './ColorSwatchPicker';
import { HistoryTrail } from './HistoryTrail';
import { ReferenceCombobox } from './ReferenceCombobox';

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
      className="wally-scroll flex h-full w-[380px] shrink-0 flex-col overflow-y-auto border-l border-border bg-card"
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

  const titleRef = useRef<HTMLTextAreaElement>(null);
  const [title, setTitle] = useState(note?.title ?? '');

  useEffect(() => {
    setTitle(note?.title ?? '');
  }, [note?.id, note?.title]);

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
      <div className="flex flex-col gap-6 p-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-6 w-6 rounded-full" />
        </div>
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  const disabled = !canEdit;
  const zoneLabel = axis === 'priority' ? 'Zeile' : 'Spalte';
  const showZone = axis !== 'free';

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
      moveNote.mutate({ noteId: note.id, input: { mode: 'HORIZON', horizon: value as (typeof noteHorizonValues)[number] } });
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
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-6 pt-5">
        <span
          role="img"
          aria-label={note.status === 'DONE' ? 'Erledigt' : `Priorität: ${PRIORITY_LABELS[note.priority]}`}
          className={cn(
            'h-2 w-2 shrink-0 rounded-full',
            note.status === 'DONE' ? 'bg-[color:var(--status-success-bold)]' : priorityToneClass[note.priority],
          )}
        />
        <span className="flex-1 text-12 font-semibold text-fg-muted">
          {note.status === 'DONE'
            ? 'Erledigt'
            : `${axis === 'priority' ? PRIORITY_LABELS[note.priority] : HORIZON_LABELS[note.horizon]} · ${PRIORITY_LABELS[note.priority]}`}
        </span>
        <IconTooltip label="Schließen">
          <button
            type="button"
            onClick={onClose}
            aria-label="Schließen"
            className="rounded-sm p-1 text-fg-muted transition-colors hover:text-fg-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)]"
          >
            <X className="h-4 w-4" />
          </button>
        </IconTooltip>
      </div>

      <div className="wally-scroll flex flex-1 flex-col gap-7 overflow-y-auto px-6 py-5">
        <Textarea
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          disabled={disabled}
          rows={2}
          placeholder="Was ist zu tun?"
          aria-label="Titel"
          className="font-head text-22 font-semibold leading-tight tracking-[-0.02em] text-fg-1"
        />

        <div className="flex flex-col gap-2">
          <span className="text-12 font-semibold text-fg-muted">Priorität</span>
          <ToggleGroup type="single" value={note.priority} onValueChange={handlePriorityChange} disabled={disabled}>
            {notePriorityValues.map((p) => (
              <ToggleGroupItem key={p} value={p} aria-label={PRIORITY_LABELS[p]}>
                <span className={cn('h-[7px] w-[7px] rounded-full', priorityToneClass[p])} />
                {PRIORITY_LABELS[p]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        {showZone && (
          <div className="flex flex-col gap-2">
            <span className="text-12 font-semibold text-fg-muted">{zoneLabel}</span>
            <ToggleGroup
              type="single"
              value={axis === 'priority' ? note.priority : note.horizon}
              onValueChange={handleZoneChange}
              disabled={disabled}
            >
              {(axis === 'priority' ? notePriorityValues : noteHorizonValues).map((key) => (
                <ToggleGroupItem key={key} value={key}>
                  {axis === 'priority' ? PRIORITY_LABELS[key as NotePriority] : HORIZON_LABELS[key as keyof typeof HORIZON_LABELS]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        )}

        <div className="grid grid-cols-2 gap-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="note-due" className="text-12 font-semibold text-fg-muted">
              Fällig
            </label>
            <Input
              id="note-due"
              type="date"
              value={note.dueDate ?? ''}
              disabled={disabled}
              onChange={(e) => updateNote.mutate({ noteId: note.id, input: { dueDate: e.target.value || null } })}
              className="h-[30px] border-0 border-b border-border-subtle p-0 focus-visible:ring-0"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-12 font-semibold text-fg-muted">Zuständig</span>
            <Select value={note.assignee?.id ?? NO_ASSIGNEE} onValueChange={handleAssigneeChange} disabled={disabled}>
              <SelectTrigger aria-label="Zuständig">
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
          </div>
        </div>

        <ReferenceCombobox
          referenceType={note.referenceType}
          referenceLabel={note.referenceLabel}
          disabled={disabled}
          onChange={(type, label) =>
            updateNote.mutate({ noteId: note.id, input: { referenceType: type, referenceLabel: label } })
          }
        />

        <TagEditor
          tags={note.tags}
          disabled={disabled}
          onAdd={(tag) => addTag.mutate({ noteId: note.id, tag })}
          onRemove={(tag) => removeTag.mutate({ noteId: note.id, tag })}
        />

        <SubtaskChecklist
          subtasks={note.subtasks}
          disabled={disabled}
          onAdd={(text) => addSubtask.mutate({ noteId: note.id, text })}
          onToggle={(subtaskId, done) => toggleSubtask.mutate({ noteId: note.id, subtaskId, done })}
          onRemove={(subtaskId) => removeSubtask.mutate({ noteId: note.id, subtaskId })}
        />

        <ColorSwatchPicker
          value={note.colour}
          disabled={disabled}
          onChange={(colour: NoteColour) => updateNote.mutate({ noteId: note.id, input: { colour } })}
        />

        <HistoryTrail history={note.history} />
      </div>

      <div className="flex items-center gap-5 border-t border-border px-6 py-4">
        <Button
          variant={note.status === 'DONE' ? 'outline' : 'default'}
          disabled={disabled}
          onClick={() => toggleStatus.mutate({ noteId: note.id, currentStatus: note.status })}
        >
          {note.status === 'DONE' ? 'Wieder offen' : 'Erledigt'}
        </Button>

        {!disabled && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="text">
                Löschen
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
      </div>
    </div>
  );
}
