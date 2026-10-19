import { RelatedNotes } from './RelatedNotes';
import { useAddLink, useRemoveLink } from '../hooks/mutations/useLinkMutations';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  CalendarDays,
  Circle,
  CircleCheck,
  Copy,
  Maximize2,
  Minimize2,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import {
  notePriorityValues,
  noteHorizonValues,
  type NoteColour,
  type NoteHorizon,
  type NotePriority,
  type UserSummary,
} from '@wally/shared';
import { useEnumLabels } from '@/i18n/enumLabels';
import { useLanguage } from '@/i18n/LanguageProvider';
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
import { MOD_KEY, useKeyboardShortcuts } from '@/lib/shortcuts';
import type { BoardAxis } from '../hooks/useBoardViewState';
import { useEscapeToClose } from '../hooks/useEscapeToClose';
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
import {
  collectFieldKeys,
  displayName,
  dueInfo,
  dueToneClass,
  noteColourFillClass,
} from '../util/noteDerived';
import type { BoardAccess } from '../util/permissions';
import { captureMutation, type MutationTicket } from '@/lib/mutationQueue';
import { PriorityIcon } from '../PriorityIcon';
import { AssigneeAvatar } from '../AssigneeAvatar';
import { useNotes } from '../hooks/useNotes';
import type { PendingProps } from '../Suggestions/pendingProps';
import { textChanged, type NoteText } from '../Suggestions/editAsk';
import { PanelSection, PropertyRow } from './Field';
import { TagEditor } from './TagEditor';
import { SubtaskChecklist } from './SubtaskChecklist';
import { ColorSwatchPicker } from './ColorSwatchPicker';
import { HistoryTrail } from './HistoryTrail';
import { CustomFieldEditor } from './CustomFieldEditor';
import { VisibilityRow } from './VisibilityRow';
import { useLiveNoteText } from './useLiveNoteText';
import { failureOf } from '@/lib/errors';
import { PendingReview } from './PendingReview';

const NO_ASSIGNEE = '__none__';

/** An empty title is never saved; leaving the field puts the last one back. */
const normalizeTitle = (raw: string) => raw.trim() || null;
/** A description may be cleared; one that is only whitespace counts as cleared. */
const normalizeDescription = (raw: string) => (raw.trim() ? raw : '');

/** A ToggleGroup rendered as a compact segmented control, for the properties grid. */
const SEGMENTED_GROUP =
  'note-detail-segment inline-flex flex-nowrap gap-0.5 rounded-md bg-inset p-0.5';

interface NoteDetailPanelProps {
  noteId: string | null;
  boardId: string;
  boardName?: string;
  access: BoardAccess;
  axis: BoardAxis;
  isBelowDesktop: boolean;
  onClose: () => void;
  onDuplicate: (noteId: string) => void;
  onOpenNote: (noteId: string) => void;
  currentUserId: string | undefined;
  /** Controlled by the shell so board commands can reveal the board. */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** The open note's pending change, reviewed at the top of the panel (plan R3). */
  pending?: PendingProps;
  /**
   * Hears an edit of the title or the text that changed the words, once it is finished: focus
   * left both fields, or the panel closed on it (the smarter-capture spec, revision "editing the
   * text asks again"). The shell decides whether Wallybot asks again.
   */
  onTextEdited?: (noteId: string) => void;
}

export function NoteDetailPanel({
  noteId,
  boardId,
  boardName,
  access,
  axis,
  isBelowDesktop,
  onClose,
  onDuplicate,
  onOpenNote,
  currentUserId,
  pending,
  onTextEdited,
  onExpandedChange,
  expanded: controlledExpanded,
}: NoteDetailPanelProps) {
  const { t } = useTranslation();
  const [localExpanded, setLocalExpanded] = useState(false);
  const expanded = controlledExpanded ?? localExpanded;
  const setExpanded = useCallback(
    (value: boolean) => {
      setLocalExpanded(value);
      onExpandedChange?.(value);
    },
    [onExpandedChange],
  );
  const isExpanded = expanded && !isBelowDesktop && Boolean(noteId);
  useEffect(() => {
    if (!noteId || isBelowDesktop) setExpanded(false);
  }, [noteId, isBelowDesktop, setExpanded]);
  useEscapeToClose(
    () => (isExpanded ? setExpanded(false) : onClose()),
    !isBelowDesktop && Boolean(noteId),
  );
  useKeyboardShortcuts(
    [{ keys: 'e', handler: () => setExpanded(!expanded) }],
    !isBelowDesktop && Boolean(noteId),
  );

  if (isBelowDesktop) {
    return (
      <Sheet open={Boolean(noteId)} onOpenChange={(open) => !open && onClose()}>
        <SheetContent side="right" className="paper-detail w-full max-w-sm p-0" hideClose>
          {noteId && (
            <NoteDetailContent
              noteId={noteId}
              boardId={boardId}
              boardName={boardName}
              expanded={false}
              access={access}
              axis={axis}
              onClose={onClose}
              onDuplicate={onDuplicate}
              onOpenNote={onOpenNote}
              currentUserId={currentUserId}
              pending={pending}
              onTextEdited={onTextEdited}
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
      // One editor stays mounted across presentations, preserving focus and live drafts.
      data-expanded={isExpanded}
      className={cn(
        'paper-detail z-drawer flex flex-col bg-surface',
        isExpanded
          ? 'paper-detail-expanded fixed inset-0'
          : 'absolute inset-y-0 right-0 w-[360px] max-w-full border-l border-border-subtle shadow-e3',
      )}
    >
      <NoteDetailContent
        key={noteId}
        noteId={noteId}
        boardId={boardId}
        boardName={boardName}
        expanded={isExpanded}
        onToggleExpanded={() => setExpanded(!expanded)}
        access={access}
        axis={axis}
        onClose={onClose}
        onDuplicate={onDuplicate}
        onOpenNote={onOpenNote}
        currentUserId={currentUserId}
        pending={pending}
        onTextEdited={onTextEdited}
        autoFocusTitle
      />
    </aside>
  );
}

interface ContentProps {
  noteId: string;
  boardId: string;
  boardName?: string;
  access: BoardAccess;
  axis: BoardAxis;
  onClose: () => void;
  onDuplicate: (noteId: string) => void;
  onOpenNote: (noteId: string) => void;
  currentUserId: string | undefined;
  pending: PendingProps | undefined;
  onTextEdited?: (noteId: string) => void;
  autoFocusTitle: boolean;
  expanded: boolean;
  onToggleExpanded?: () => void;
}

function NoteDetailContent({
  noteId,
  boardId,
  boardName,
  access,
  axis,
  onClose,
  onDuplicate,
  onOpenNote,
  currentUserId,
  pending,
  onTextEdited,
  autoFocusTitle,
  expanded,
  onToggleExpanded,
}: ContentProps) {
  const { t } = useTranslation();
  const { priority: priorityLabels, horizon: horizonLabels } = useEnumLabels();
  const { data: note, isLoading, error: loadError, refetch } = useNoteDetail(noteId);
  const { activeMembers } = useActiveMembers(boardId);
  // Same cached query the board renders from — no extra fetch.
  const { data: boardNotes } = useNotes(boardId);
  const { language } = useLanguage();
  const fieldKeySuggestions = useMemo(
    () => collectFieldKeys(boardNotes ?? [], language),
    [boardNotes, language],
  );

  const addLink = useAddLink(boardId);
  const removeLink = useRemoveLink(boardId);
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
  /*
   * One edit of the words runs from focus entering the title or the text until it leaves both
   * (or the panel closes on it). A finished edit that changed the words is reported once.
   */
  const textNow = useRef({ title: title.value, description: description.value });
  textNow.current = { title: title.value, description: description.value };
  // An edit is measured from the note's words, never from the field: the panel focuses the
  // title on open a moment before the loaded words reach it.
  const noteText = { title: note?.title ?? '', description: note?.description ?? '' };
  const textBefore = useRef(noteText);
  textBefore.current = noteText;
  const editStart = useRef<NoteText | null>(null);
  const reportEdit = useRef(onTextEdited);
  reportEdit.current = onTextEdited;
  const finishEdit = useCallback((id: string) => {
    const before = editStart.current;
    editStart.current = null;
    if (before && textChanged(before, textNow.current)) reportEdit.current?.(id);
  }, []);
  // The panel closing (or moving to another note) mid-edit finishes the edit it was in.
  useEffect(() => () => finishEdit(noteId), [finishEdit, noteId]);
  /** Focus moving between the title and the text stays one edit. */
  const textEdit = {
    onFocus: () => {
      editStart.current ??= { ...textBefore.current };
    },
    leaving: (e: FocusEvent<HTMLTextAreaElement>) => {
      const next = e.relatedTarget;
      if (next === title.ref.current || next === description.ref.current) return;
      finishEdit(noteId);
    },
  };

  const noteReady = Boolean(note);
  const titleRef = title.ref;
  const articleRef = useRef<HTMLElement>(null);
  const resizeTitle = title.resize;
  const resizeDescription = description.resize;
  // Changing presentation changes wrapping without changing the text value.
  useLayoutEffect(() => {
    resizeTitle();
    resizeDescription();
  }, [expanded, noteReady, resizeTitle, resizeDescription]);

  useEffect(() => {
    const article = articleRef.current;
    if (!article || typeof ResizeObserver === 'undefined') return;
    let width = article.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const next = article.getBoundingClientRect().width;
      if (next === width) return;
      width = next;
      resizeTitle();
      resizeDescription();
    });
    observer.observe(article);
    return () => observer.disconnect();
  }, [noteReady, resizeTitle, resizeDescription]);

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

  /*
   * The review can go from under the keyboard: a keep's undo, a typed row unticked (its
   * ordinary update moves the note past the change's revision, so the change goes, R4), or a
   * change gone stale. Focus that was in it then lands on the panel's close button, where Tab
   * carries on through the panel, never on the page behind it. Focus the person moved out of
   * the review first (a click on the page, a field in the panel) is theirs and stays there.
   */
  const showReview = Boolean(pending);
  const closeRef = useRef<HTMLButtonElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  const wasExpanded = useRef(expanded);
  useLayoutEffect(() => {
    // Back only exists full-screen. Give its keyboard focus to a surviving control.
    if (wasExpanded.current && !expanded && document.activeElement === document.body) {
      expandRef.current?.focus({ preventScroll: true });
    }
    wasExpanded.current = expanded;
  }, [expanded]);
  const reviewHadFocus = useRef(false);
  useLayoutEffect(() => {
    if (showReview) return;
    const lost = !document.activeElement || document.activeElement === document.body;
    if (reviewHadFocus.current && lost) closeRef.current?.focus({ preventScroll: true });
    reviewHadFocus.current = false;
  }, [showReview]);

  // A note that cannot be shown says why, instead of a skeleton that never resolves (the error
  // handling spec, 2026-10-19): gone or hidden, or a load that failed and can be tried again.
  if (!note && loadError) {
    const gone = failureOf(loadError)?.kind === 'refused';
    return (
      <div role="alert" className="flex flex-col items-start gap-3 p-5">
        <p className="text-14 font-medium text-fg-1">
          {t(gone ? 'errors.noteGone' : 'errors.noteFailed')}
        </p>
        <div className="flex gap-2">
          {!gone && (
            <Button size="sm" onClick={() => void refetch()}>
              {t('common.retry')}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      </div>
    );
  }

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
  const due = dueInfo(note, t);

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
    <div className="note-detail-content flex h-full min-h-0 flex-col">
      {/* Completion leads the panel, as a toggle that says what it does. It is a checkbox
          (role and state), never a footer button: a filled "Done" in the bottom confirm
          slot read as "dismiss this panel", and people completed to-dos trying to close. */}
      <header className="note-detail-header">
        {expanded && (
          <Button variant="ghost" size="sm" onClick={onToggleExpanded} className="note-detail-back">
            <ArrowLeft strokeWidth={1.75} />
            {t(axis === 'free' ? 'board.rail.whiteboard' : `board.topBar.axis.${axis}.label`)}
          </Button>
        )}
        <button
          type="button"
          role="checkbox"
          aria-checked={isDone}
          aria-label={t('note.doneStatus')}
          disabled={disabled}
          onClick={() => toggleStatus.mutate({ noteId: note.id, currentStatus: note.status })}
          className={cn(
            'note-detail-complete inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-12 font-medium',
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
        <span className="note-detail-header-spacer" />
        {onToggleExpanded && (
          <IconTooltip label={t(expanded ? 'note.collapse' : 'note.expand')} shortcut={['E']}>
            <Button
              variant="ghost"
              size="icon-sm"
              ref={expandRef}
              onClick={onToggleExpanded}
              aria-label={t(expanded ? 'note.collapse' : 'note.expand')}
            >
              {expanded ? <Minimize2 strokeWidth={1.75} /> : <Maximize2 strokeWidth={1.75} />}
            </Button>
          </IconTooltip>
        )}
        <IconTooltip label={t('common.close')} shortcut={['Esc']}>
          <Button
            ref={closeRef}
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            <X strokeWidth={1.75} />
          </Button>
        </IconTooltip>
      </header>

      <div
        onFocusCapture={(e) => {
          reviewHadFocus.current =
            e.target instanceof Element && e.target.closest('[data-pending-review]') !== null;
        }}
        onBlurCapture={(e) => {
          // A control removed with the review is not a move; the restore above answers that.
          if (e.target instanceof Node && !e.target.isConnected) return;
          const next = e.relatedTarget;
          if (!(next instanceof Node) || !e.currentTarget.contains(next))
            reviewHadFocus.current = false;
        }}
        className="note-detail-scroll wally-scroll min-h-0 flex-1 overflow-y-auto"
      >
        <article ref={articleRef} className="note-detail-article">
          <div className="note-detail-intro">
            <div className="note-detail-eyebrow">
              <span
                aria-hidden
                className={cn('note-detail-colour', noteColourFillClass[note.colour])}
              />
              <span>
                {boardName
                  ? `${boardName} · ${horizonLabels[note.horizon]}`
                  : horizonLabels[note.horizon]}
              </span>
            </div>
            <textarea
              ref={titleRef}
              value={title.value}
              onChange={(e) => title.onChange(e.target.value)}
              onFocus={textEdit.onFocus}
              onBlur={(e) => {
                title.onBlur();
                textEdit.leaving(e);
              }}
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
                'note-detail-title block w-full resize-none overflow-hidden rounded-md bg-transparent text-20 font-semibold text-fg-1 outline-none',
                'placeholder:text-fg-faint',
                'disabled:cursor-not-allowed disabled:opacity-70',
                isDone && 'text-fg-3 line-through decoration-fg-faint',
                // Wallybot is reading the note: the same shimmer as the card's title.
                pending?.mark.phase === 'asking' && 'capture-shimmer',
              )}
            />
            {expanded && (
              <div className="note-detail-summary">
                <span className={dueToneClass[due.tone]}>
                  <CalendarDays aria-hidden />
                  {due.label}
                </span>
                <span>
                  <PriorityIcon priority={note.priority} />
                  {priorityLabels[note.priority]}
                </span>
                {note.assignee && (
                  <span>
                    <UserRound aria-hidden />
                    {displayName(note.assignee)}
                  </span>
                )}
              </div>
            )}
          </div>
          {/* Deliberately bare: no label, no border, no toolbar — it reads as the line under
              the title until you write in it. Enter is a new line here, unlike the title. */}
          <textarea
            ref={description.ref}
            value={description.value}
            onChange={(e) => description.onChange(e.target.value)}
            onFocus={textEdit.onFocus}
            onBlur={(e) => {
              description.onBlur();
              textEdit.leaving(e);
            }}
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
              'note-detail-description block w-full resize-none overflow-hidden rounded-md bg-transparent text-14 leading-relaxed text-fg-2 outline-none',
              'placeholder:text-fg-faint',
              'disabled:cursor-not-allowed disabled:opacity-70',
              disabled && !description.value && 'hidden',
            )}
          />

          {pending && showReview && <PendingReview note={note} pending={pending} />}

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

          <PanelSection className="note-detail-properties">
            <h2 className="note-detail-section-heading">{t('note.details')}</h2>
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
                // The helper wraps rather than truncating, so on a narrow screen the rule stays
                // readable. Items align to the top so a wrapped line sits beside the avatar.
                <span className="flex min-w-0 items-start gap-2">
                  {note.assignee && (
                    <AssigneeAvatar user={note.assignee} isYou size="sm" className="shrink-0" />
                  )}
                  <span className="shrink-0 text-13 text-fg-1">{t('common.you')}</span>
                  <span className="min-w-0 text-12 leading-snug text-fg-3">
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
            <RelatedNotes
              note={note}
              notes={boardNotes ?? []}
              disabled={disabled}
              onOpen={onOpenNote}
              onAdd={(targetId) => addLink.mutate({ noteId: note.id, targetId })}
              onRemove={(targetId) => removeLink.mutate({ noteId: note.id, targetId })}
            />
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

          {note.history.length > 0 && (
            <PanelSection>
              <details className="note-detail-activity">
                <summary>{t('note.showActivity', { count: note.history.length })}</summary>
                <HistoryTrail history={note.history} />
              </details>
            </PanelSection>
          )}
        </article>
      </div>

      {/* No confirmation dialog for Delete: the note goes at once and a toast offers Undo,
          which is both faster and safer than "Are you sure?". Duplicate sits beside it and
          opens the copy straight away, the same as ⌘D. */}
      {!disabled && (
        <footer className="note-detail-footer flex shrink-0 items-center justify-between px-3 py-2">
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
