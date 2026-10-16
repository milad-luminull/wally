import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type TextareaHTMLAttributes,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { NoteVisibility } from '@wally/shared';
import { useLanguage } from '@/i18n/LanguageProvider';
import { parseIsoDate } from '@/i18n/dates';
import { cn } from '@/lib/cn';
import { parseCapture, type CaptureParse } from '@/lib/capture/parseCapture';
import { useActiveMembers } from '../hooks/useMembers';
import { noteColourFillClass } from '../util/noteDerived';
import { CaptureChips, type ChipKind, type ChipState } from './CaptureChips';
import { useCapture, type CaptureFields, type CapturePlacement } from './useCapture';

/**
 * Chips start kept, except a priority on the priority wall: keeping it would move the note out
 * of the band the person placed it in, and a placed note never moves unasked (spec §7,
 * decision 1). There it is shown, and a tap keeps it.
 */
function initialChips(placement: CapturePlacement): ChipState {
  const placedByPriority = placement.kind === 'zone' && placement.axis === 'priority';
  return {
    kept: { dueDate: true, assignee: true, priority: !placedByPriority },
    dropped: { dueDate: false, assignee: false, priority: false },
  };
}

/** The card's own controls; a press anywhere else on the card must not take focus from them. */
const OWN_CONTROLS = 'textarea, input, button';

/** Grows a textarea to its content, so the card expands in place instead of scrolling. */
function fitToContent(field: HTMLTextAreaElement | null) {
  if (!field) return;
  field.style.height = 'auto';
  field.style.height = `${field.scrollHeight}px`;
}

/** The field and its mirror: the textarea draws the caret and takes input; the div behind it draws the same text with the matches underlined. */
const MirroredField = forwardRef<
  HTMLTextAreaElement,
  { value: string; parse: CaptureParse | null } & TextareaHTMLAttributes<HTMLTextAreaElement>
>(function MirroredField({ value, parse, ...props }, ref) {
  const matches = parse
    ? [parse.dueDate, parse.assignee, parse.priority]
        .filter((m): m is NonNullable<typeof m> => m !== null)
        .sort((a, b) => a.start - b.start)
    : [];
  const pieces: { text: string; mark: boolean }[] = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.start < cursor) continue;
    if (m.start > cursor) pieces.push({ text: value.slice(cursor, m.start), mark: false });
    pieces.push({ text: value.slice(m.start, m.end), mark: true });
    cursor = m.end;
  }
  if (cursor < value.length) pieces.push({ text: value.slice(cursor), mark: false });
  const shared = 'whitespace-pre-wrap break-words text-14 font-medium leading-snug';
  return (
    <div className="relative">
      <div aria-hidden className={cn(shared, 'pointer-events-none absolute inset-0 text-fg-1')}>
        {pieces.map((p, i) =>
          p.mark ? (
            <span
              key={i}
              data-testid="capture-mark"
              className="underline decoration-fg-3 decoration-dotted underline-offset-2"
            >
              {p.text}
            </span>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
        {value.endsWith('\n') && <br />}
      </div>
      <textarea
        {...props}
        ref={ref}
        value={value}
        rows={1}
        className={cn(
          shared,
          'relative block w-full resize-none overflow-hidden bg-transparent text-transparent caret-fg-1 outline-none placeholder:text-fg-faint',
        )}
      />
    </div>
  );
});

/**
 * The card the person writes in, on the wall (or as a list row) where the note will live
 * (WALLYBOT_INLINE.md §3.1). Its own component, never a mode of NoteCard: it may animate in
 * because the real card replaces it on commit and it is never dragged.
 */
export function InlineCaptureCard({
  boardId,
  placement,
  visibility,
  layout,
  onDone,
  onNoteId,
}: {
  boardId: string;
  placement: CapturePlacement;
  visibility: NoteVisibility;
  layout: 'card' | 'row';
  /** `noteId` is null when the capture was cancelled; `open` asks for the note's sidebar. */
  onDone: (noteId: string | null, open: boolean) => void;
  /**
   * Hears each id the note being written is shown under (its temp id, then its real one),
   * before the board shows it, so the board can leave that note to this card until it is done.
   */
  onNoteId?: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const { language } = useLanguage();
  const { activeMembers } = useActiveMembers(boardId);
  const controller = useCapture(boardId, placement, visibility, { onDone, onNoteId });
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [showText, setShowText] = useState(false);
  const [chips, setChips] = useState<ChipState>(() => initialChips(placement));
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  // Set once a commit or cancel is under way, so Enter, Esc and blur settle the capture once.
  const settling = useRef(false);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);
  useEffect(() => {
    if (showText) textRef.current?.focus();
  }, [showText]);
  useLayoutEffect(() => fitToContent(titleRef.current), [title]);
  useLayoutEffect(() => fitToContent(textRef.current), [description, showText]);
  const { saveDraft } = controller;
  useEffect(() => {
    saveDraft({ title: title.trim(), description: description.trim() });
  }, [saveDraft, title, description]);

  // A private note is always assigned to its creator (the API answers anything else with 422
  // PRIVATE_NOTE_NOT_ASSIGNABLE, and the create already assigns them), so a private capture
  // proposes no person at all.
  const members = useMemo(
    () =>
      visibility === 'PRIVATE'
        ? []
        : activeMembers.flatMap((m) =>
            m.userId ? [{ id: m.userId, displayName: m.displayName, email: m.email }] : [],
          ),
    [activeMembers, visibility],
  );
  const parse = useMemo(
    () => (title ? parseCapture(title, { language, today: new Date(), members }) : null),
    [title, language, members],
  );
  const memberName = parse?.assignee
    ? (activeMembers.find((m) => m.userId === parse.assignee!.memberId)?.displayName ?? null)
    : null;
  const dateLabel = parse?.dueDate
    ? new Intl.DateTimeFormat(i18n.language, {
        weekday: 'short',
        day: '2-digit',
        month: '2-digit',
      }).format(parseIsoDate(parse.dueDate.iso))
    : null;

  const applies = (kind: ChipKind) => chips.kept[kind] && !chips.dropped[kind];
  function fields(): CaptureFields {
    return {
      dueDate: parse?.dueDate && applies('dueDate') ? parse.dueDate.iso : null,
      assigneeId: parse?.assignee && applies('assignee') ? parse.assignee.memberId : null,
      priority: parse?.priority && applies('priority') ? parse.priority.value : null,
    };
  }
  /** Words in either field make a note; whitespace alone in both does not. */
  const hasWords = Boolean(title.trim() || description.trim());
  async function commit(thenOpen: boolean) {
    const trimmed = title.trim();
    if (!hasWords || settling.current) return;
    settling.current = true;
    try {
      await controller.commit(
        { title: trimmed, description: description.trim(), fields: fields() },
        thenOpen,
      );
    } catch {
      // The global mutation handler reports the failure; the card stays so nothing is lost,
      // with the caret back in the title so Enter retries.
      settling.current = false;
      titleRef.current?.focus();
    }
  }
  async function cancel() {
    if (settling.current) return;
    settling.current = true;
    await controller.cancel();
  }
  function onTitleChange(next: string) {
    if (!title && next) controller.onFirstKeystroke({ title: next, description });
    setTitle(next);
  }
  function onDescriptionChange(next: string) {
    if (!description && next) controller.onFirstKeystroke({ title, description: next });
    setDescription(next);
  }
  /** The capture owns the keys it handles: no board shortcut, Esc-to-close or deselect sees them. */
  function claim(event: KeyboardEvent<HTMLTextAreaElement>) {
    event.preventDefault();
    event.stopPropagation();
  }
  function onTitleKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' && event.shiftKey) {
      claim(event);
      setShowText(true);
    } else if (event.key === 'Enter') {
      claim(event);
      void commit(event.metaKey || event.ctrlKey);
    } else if (event.key === 'Escape') {
      claim(event);
      void cancel();
    }
  }
  function onTextKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      claim(event);
      void commit(event.metaKey || event.ctrlKey);
    } else if (event.key === 'Escape') {
      claim(event);
      void cancel();
    }
  }
  function onBlur(event: FocusEvent<HTMLDivElement>) {
    // Focus moving between the card's own fields and chips is not leaving the capture.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    if (hasWords) void commit(false);
    else void cancel();
  }
  const toggle = (kind: ChipKind) =>
    setChips((s) => ({ ...s, kept: { ...s.kept, [kind]: !s.kept[kind] } }));
  const drop = (kind: ChipKind) =>
    setChips((s) => ({ ...s, dropped: { ...s.dropped, [kind]: true } }));

  return (
    <div
      role="group"
      aria-label={t('capture.cardAria')}
      data-layout={layout}
      onBlur={onBlur}
      // A press on the card's padding, gaps or hint would move focus to the page, and the blur
      // would settle the capture; only its fields and buttons take focus.
      onMouseDown={(e) => {
        if (!(e.target as HTMLElement).closest(OWN_CONTROLS)) e.preventDefault();
      }}
      className={cn(
        'relative flex flex-col gap-2 rounded-lg border border-[color:var(--note-border)] p-3 text-left shadow-e2',
        'ring-2 ring-inset ring-[color:var(--note-selected)]',
        // Grows from the click point: the card's top-left is where the person clicked.
        'animate-capture-in motion-reduce:animate-none',
        layout === 'card' ? 'origin-top-left' : 'origin-top',
        noteColourFillClass.WEISS,
        layout === 'card' ? 'w-[248px]' : 'w-full',
      )}
    >
      <MirroredField
        ref={titleRef}
        value={title}
        parse={parse}
        onChange={(e) => onTitleChange(e.target.value)}
        onKeyDown={onTitleKey}
        aria-label={t('capture.titleAria')}
        placeholder={t('note.titlePlaceholder')}
        // Read-only rather than disabled while committing: a disabled field loses focus, and
        // whether that fires blur differs by browser; read-only keeps the caret where it was.
        readOnly={controller.state === 'committing'}
        aria-busy={controller.state === 'committing'}
      />
      {showText && (
        <textarea
          ref={textRef}
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          onKeyDown={onTextKey}
          rows={2}
          aria-label={t('capture.descriptionAria')}
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
          onToggle={toggle}
          onDrop={drop}
        />
      )}
      <p className="text-12 text-fg-faint [@media(pointer:coarse)]:hidden">{t('capture.hint')}</p>
      <p className="hidden text-12 text-fg-faint [@media(pointer:coarse)]:block">
        {t('capture.hintCoarse')}
      </p>
    </div>
  );
}
