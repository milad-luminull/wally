import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { NoteDto, SuggestionFieldKey } from '@wally/shared';
import { NOTE_TITLE_MAX_LENGTH } from '@wally/shared';
import { useLanguage } from '@/i18n/LanguageProvider';
import { parseIsoDate } from '@/i18n/dates';
import { cn } from '@/lib/cn';
import { parseCapture, type CaptureParse } from '@/lib/capture/parseCapture';
import { useActiveMembers } from '../hooks/useMembers';
import { useAssignNote } from '../hooks/mutations/useAssignNote';
import { useMoveNote } from '../hooks/mutations/useMoveNote';
import { useUpdateNote } from '../hooks/mutations/useUpdateNote';
import { noteColourFillClass } from '../util/noteDerived';
import { textChanged } from '../Suggestions/editAsk';
import { shownText, type PendingProps } from '../Suggestions/pendingProps';
import { CaptureChips, type ChipKind, type ChipState } from './CaptureChips';
import { MirroredField } from './captureField';
import { fitToContent, withoutDropped } from './captureText';

/** How an edit ended: null for Esc (nothing written), otherwise whether the words changed. */
export interface EditResult {
  changed: boolean;
  /** ⌘/Ctrl+Enter: open the note's sidebar once it is saved. */
  open: boolean;
  /** The fields a kept chip set: an ask that follows leaves them alone. */
  locked: SuggestionFieldKey[];
}

const ALL_KEPT: ChipState = {
  kept: { dueDate: true, assignee: true, priority: true },
  dropped: { dueDate: false, assignee: false, priority: false },
};

/** The card's own controls; a press anywhere else on the card must not take focus from them. */
const OWN_CONTROLS = 'textarea, input, button';

/** The schema keeps a description as typed; only whitespace alone counts as no text. */
const asTyped = (text: string) => (text.trim() ? text : '');

/**
 * Only words the person adds are read as fields: a date or a name the title already held was
 * read when the note was written, and "tomorrow" in an old title is not tomorrow any more.
 */
function onlyNewWords(parse: CaptureParse | null, title: string, before: string) {
  if (!parse) return null;
  const known = before.toLocaleLowerCase();
  const fresh = <M extends { start: number; end: number }>(m: M | null) =>
    m && !known.includes(title.slice(m.start, m.end).toLocaleLowerCase()) ? m : null;
  const next = {
    dueDate: fresh(parse.dueDate),
    assignee: fresh(parse.assignee),
    priority: fresh(parse.priority),
  };
  return next.dueDate || next.assignee || next.priority ? next : null;
}

/**
 * A note's words edited in place, on the wall or as a list row (the smarter-capture spec,
 * revision "editing the text asks again"): the capture card's field, opened on the words the
 * note shows (the cleaned ones while the Title row is in the change), with the same chips for
 * new words. Enter or a click away saves, ⌘/Ctrl+Enter saves and opens the sidebar, Esc puts
 * the words back and writes nothing. Words left as they were write nothing either.
 */
export function InlineNoteEditor({
  boardId,
  note,
  pending,
  layout,
  onDone,
}: {
  boardId: string;
  note: NoteDto;
  pending?: PendingProps;
  layout: 'card' | 'row';
  onDone: (result: EditResult | null) => void;
}) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { activeMembers } = useActiveMembers(boardId);
  const { mutateAsync: updateNote } = useUpdateNote(boardId);
  const { mutateAsync: moveNote } = useMoveNote(boardId);
  const { mutateAsync: assignNote } = useAssignNote(boardId);
  // What the editor opened on, read once: a refetch while typing does not move the words.
  const [initial] = useState(() => shownText(note, pending));
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [showText, setShowText] = useState(initial.description !== '');
  const [chips, setChips] = useState<ChipState>(ALL_KEPT);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  // Set once a save or Esc is under way, so Enter, Esc and blur settle the edit once.
  const settling = useRef(false);
  const hintId = useId();

  useEffect(() => {
    const field = titleRef.current;
    if (!field) return;
    field.focus({ preventScroll: true });
    field.selectionStart = field.selectionEnd = field.value.length;
  }, []);
  const opened = useRef(false);
  useEffect(() => {
    // The text field takes focus when Shift+Enter opens it, not when the editor opens on it.
    if (showText && opened.current) textRef.current?.focus();
    opened.current = true;
  }, [showText]);
  useLayoutEffect(() => fitToContent(titleRef.current), [title]);
  useLayoutEffect(() => fitToContent(textRef.current), [description, showText]);

  // A private note is its author's alone: no person is read from its words.
  const members = useMemo(
    () =>
      note.visibility === 'PRIVATE'
        ? []
        : activeMembers.flatMap((m) =>
            m.userId ? [{ id: m.userId, displayName: m.displayName, email: m.email }] : [],
          ),
    [activeMembers, note.visibility],
  );
  const parse = useMemo(
    () =>
      title
        ? onlyNewWords(
            parseCapture(title, { language, today: new Date(), members }),
            title,
            initial.title,
          )
        : null,
    [title, language, members, initial.title],
  );
  const memberName = parse?.assignee
    ? (activeMembers.find((m) => m.userId === parse.assignee!.memberId)?.displayName ?? null)
    : null;
  const dateLabel = parse?.dueDate
    ? new Intl.DateTimeFormat(language, {
        weekday: 'short',
        day: '2-digit',
        month: '2-digit',
      }).format(parseIsoDate(parse.dueDate.iso))
    : null;
  const applies = (kind: ChipKind) => chips.kept[kind] && !chips.dropped[kind];
  const dueDate = parse?.dueDate && applies('dueDate') ? parse.dueDate.iso : null;
  const priority = parse?.priority && applies('priority') ? parse.priority.value : null;
  const assigneeId = parse?.assignee && applies('assignee') ? parse.assignee.memberId : null;

  async function save(open: boolean) {
    if (settling.current) return;
    const trimmed = title.trim();
    // Both fields erased: there is no note without words, so this is Esc.
    if (!trimmed && !description.trim()) return cancel();
    settling.current = true;
    const changed = textChanged(initial, { title: trimmed, description });
    if (!changed) {
      onDone({ changed: false, open, locked: [] });
      return;
    }
    setBusy(true);
    try {
      await updateNote({
        noteId: note.id,
        input: {
          title: trimmed,
          description: asTyped(description),
          ...(dueDate ? { dueDate } : {}),
        },
      });
      // noteUpdateSchema carries no priority; the move endpoint owns that field alone.
      if (priority) await moveNote({ noteId: note.id, input: { mode: 'PRIORITY', priority } });
      if (assigneeId) await assignNote({ noteId: note.id, assigneeId });
      const locked: SuggestionFieldKey[] = [
        ...(dueDate ? (['dueDate'] as const) : []),
        ...(priority ? (['priority'] as const) : []),
        ...(assigneeId ? (['assignee'] as const) : []),
      ];
      onDone({ changed: true, open, locked });
    } catch {
      // The global mutation handler reports the failure; the words stay, and Enter retries.
      settling.current = false;
      setBusy(false);
      titleRef.current?.focus();
    }
  }
  function cancel() {
    if (settling.current) return;
    settling.current = true;
    onDone(null);
  }
  /** The editor owns the keys it handles: no board shortcut, Esc-to-close or deselect sees them. */
  function claim(event: KeyboardEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
  }
  function onTitleKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' && event.shiftKey) {
      claim(event);
      if (showText) textRef.current?.focus();
      else setShowText(true);
    } else if (event.key === 'Enter') {
      claim(event);
      void save(event.metaKey || event.ctrlKey);
    } else if (event.key === 'Escape') {
      claim(event);
      cancel();
    }
  }
  function onTextKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      claim(event);
      void save(event.metaKey || event.ctrlKey);
    } else if (event.key === 'Escape') {
      claim(event);
      cancel();
    }
  }
  /** While a chip has focus the editor still owns Esc and the board's single keys. */
  function onCardKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      claim(event);
      cancel();
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.stopPropagation();
    }
  }
  function onBlur(event: FocusEvent<HTMLDivElement>) {
    // Focus moving between the editor's own fields and chips is not leaving it.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    void save(false);
  }

  return (
    <div
      role="group"
      aria-label={t('noteEdit.cardAria')}
      data-note-editor
      data-layout={layout}
      onBlur={onBlur}
      onKeyDown={onCardKey}
      // Presses on the editor never reach the card or row under it (open, drag, select).
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => {
        e.stopPropagation();
        if (!(e.target as HTMLElement).closest(OWN_CONTROLS)) e.preventDefault();
      }}
      className={cn(
        'relative flex flex-col gap-2 rounded-lg border border-[color:var(--note-border)] p-3 text-left shadow-e2',
        'ring-2 ring-inset ring-[color:var(--note-selected)]',
        noteColourFillClass[note.colour],
        layout === 'card' ? 'w-[248px]' : 'w-full',
      )}
    >
      <MirroredField
        ref={titleRef}
        value={title}
        parse={withoutDropped(parse, chips)}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={onTitleKey}
        aria-label={t('noteEdit.titleAria')}
        aria-describedby={hintId}
        placeholder={t('note.titlePlaceholder')}
        maxLength={NOTE_TITLE_MAX_LENGTH}
        readOnly={busy}
        aria-busy={busy}
      />
      {showText && (
        <textarea
          ref={textRef}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={onTextKey}
          rows={2}
          readOnly={busy}
          aria-label={t('noteEdit.descriptionAria')}
          placeholder={t('note.descriptionPlaceholder')}
          className="block w-full resize-none overflow-hidden bg-transparent text-12 leading-snug text-fg-meta-on-note outline-none placeholder:text-fg-faint"
        />
      )}
      {parse && (
        <CaptureChips
          parse={parse}
          memberName={memberName}
          dateLabel={dateLabel}
          state={chips}
          onToggle={(kind) =>
            setChips((s) => ({ ...s, kept: { ...s.kept, [kind]: !s.kept[kind] } }))
          }
          onDrop={(kind) => setChips((s) => ({ ...s, dropped: { ...s.dropped, [kind]: true } }))}
        />
      )}
      <p id={hintId} className="font-mono text-12 text-fg-faint [@media(pointer:coarse)]:hidden">
        {t('noteEdit.hint')}
      </p>
      <p className="hidden text-12 text-fg-faint [@media(pointer:coarse)]:block">
        {t('noteEdit.hintCoarse')}
      </p>
    </div>
  );
}
