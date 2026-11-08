import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type Ref,
} from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import {
  INTAKE_MESSAGE_MAX,
  suggestionFieldKeys,
  type NoteDto,
  type NoteVisibility,
  type SuggestionFieldKey,
} from '@wally/shared';
import { BrandMark } from '@/components/BrandMark';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/i18n/languageContext';
import { parseIsoDate } from '@/i18n/dates';
import { cn } from '@/lib/cn';
import { guessIntent, type Intent } from '@/lib/capture/intentGuess';
import { parseCapture } from '@/lib/capture/parseCapture';
import { CaptureChips, type ChipKind, type ChipState } from '../Capture/CaptureChips';
import { MirroredField } from '../Capture/captureField';
import { fitToContent, withoutDropped } from '../Capture/captureText';
import { useActiveMembers } from '../hooks/useMembers';
import { BoxAnswer } from './BoxAnswer';
import { flashNotes } from './flash';
import type { CapturePlacement } from './placement';
import { lastAnswer, type CaptureFields, type WallyBoxController } from './useWallyBox';

/** Chips start kept, except a priority on the priority wall: the note stays in its band. */
function initialChips(placement: CapturePlacement): ChipState {
  const placedByPriority = placement.kind === 'zone' && placement.axis === 'priority';
  return {
    kept: { dueDate: true, assignee: true, priority: !placedByPriority },
    dropped: { dueDate: false, assignee: false, priority: false },
  };
}

/** The box's own controls; a press anywhere else in it must not take focus from them. */
const OWN_CONTROLS = 'textarea, input, button, a';

/**
 * The Wally box (docs/superpowers/specs/2026-11-08-wally-box-design.md §3): the one place to
 * write a note or ask, docked at the bottom of the board or anchored where the person
 * double-clicked. Enter frees it at once; what is in flight waits as chips, and only the latest
 * reply shows above the field. No pop-up, no history.
 */
export function WallyBox({
  boardId,
  box,
  mode,
  assistantEnabled,
  notes,
  placement,
  visibility,
  visibilityChosen = false,
  onOpenNote,
  onDismiss,
  inputRef,
  restored,
}: {
  boardId: string;
  box: WallyBoxController;
  mode: 'docked' | 'anchored';
  assistantEnabled: boolean;
  /** The board's notes: the rows under an answer read like the list. */
  notes: NoteDto[] | undefined;
  /** Where a note written here lands. */
  placement: CapturePlacement;
  visibility: NoteVisibility;
  /** The board's filter chose the visibility: Wally then never proposes one. */
  visibilityChosen?: boolean;
  onOpenNote: (noteId: string) => void;
  /** Anchored only: Esc on an empty box, a click away from it, or a message sent. */
  onDismiss?: () => void;
  inputRef?: Ref<HTMLTextAreaElement>;
  /** Words to put back in an empty field: a question Wally could not answer. */
  restored?: { text: string; at: number } | null;
}) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { activeMembers } = useActiveMembers(boardId);
  const [text, setText] = useState('');
  const [pinned, setPinned] = useState<Intent | null>(null);
  const [chips, setChips] = useState<ChipState>(() => initialChips(placement));
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const hintId = useId();
  const { reply } = box;

  useLayoutEffect(() => fitToContent(fieldRef.current), [text]);
  // A question that failed comes back, unless the person has started typing something new.
  useEffect(() => {
    if (restored) setText((now) => (now.trim() ? now : restored.text));
  }, [restored]);
  useEffect(() => {
    if (mode === 'anchored') fieldRef.current?.focus();
  }, [mode]);
  // The cards an answer or a duplicate is about wear the ring for a moment.
  useEffect(() => {
    if (reply?.kind === 'duplicate') flashNotes([reply.note.id]);
    if (reply?.kind === 'answer' && reply.outcome.kind === 'answered') {
      const last = lastAnswer(reply.outcome.conversation);
      if (last) flashNotes(last.chips.map((chip) => chip.id));
    }
  }, [reply]);

  const words = text.trim();
  const intent: Intent = pinned ?? guessIntent(text);
  const showsHint = assistantEnabled && words.length > 0;
  // The instant chips read one line meant as a note; a question or several lines is Wally's.
  const parsesFields =
    words.length > 0 && !text.includes('\n') && (!assistantEnabled || intent === 'note');
  // A private note is always its creator's, so a private note proposes no person at all.
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
    () => (parsesFields ? parseCapture(text, { language, today: new Date(), members }) : null),
    [parsesFields, text, language, members],
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
  const fields: CaptureFields = {
    dueDate: parse?.dueDate && applies('dueDate') ? parse.dueDate.iso : null,
    assigneeId: parse?.assignee && applies('assignee') ? parse.assignee.memberId : null,
    priority: parse?.priority && applies('priority') ? parse.priority.value : null,
  };
  /** What the person decided here: a kept chip, a band they placed it in, the Shared filter. */
  const locked: SuggestionFieldKey[] = suggestionFieldKeys.filter((key) => {
    const placedByPriority = placement.kind === 'zone' && placement.axis === 'priority';
    const pickedHorizon =
      placement.kind === 'zone' && placement.axis === 'horizon' && placement.picked === true;
    if (key === 'dueDate') return fields.dueDate !== null;
    if (key === 'priority') return fields.priority !== null || placedByPriority;
    if (key === 'assignee') return fields.assigneeId !== null;
    if (key === 'horizon') return pickedHorizon;
    if (key === 'visibility') return visibilityChosen;
    return false;
  });

  function reset() {
    setText('');
    setPinned(null);
    setChips(initialChips(placement));
  }
  function send(open: boolean) {
    if (!words) return;
    box.send(text, {
      pinned: open ? 'note' : assistantEnabled ? pinned : null,
      fields,
      locked,
      open,
      placement,
    });
    reset();
    if (mode === 'anchored') onDismiss?.();
  }
  function onFieldKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    const claim = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (event.key === 'Enter' && !event.shiftKey) {
      claim();
      send(event.metaKey || event.ctrlKey);
    } else if (event.key === 'Tab' && !event.shiftKey && showsHint) {
      claim();
      setPinned(intent === 'note' ? 'ask' : 'note');
    } else if (event.key === 'Escape') {
      claim();
      if (reply) box.closeReply();
      else if (mode === 'anchored' && !words) onDismiss?.();
      else fieldRef.current?.blur();
    }
  }
  function onBlur(event: FocusEvent<HTMLDivElement>) {
    // An anchored box with nothing typed goes back to the dock when the person clicks away.
    if (mode !== 'anchored' || words) return;
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    onDismiss?.();
  }
  const setRefs = (node: HTMLTextAreaElement | null) => {
    fieldRef.current = node;
    if (typeof inputRef === 'function') inputRef(node);
    else if (inputRef) (inputRef as { current: HTMLTextAreaElement | null }).current = node;
  };
  const hint = t(intent === 'note' ? 'box.hintNote' : 'box.hintAsk');

  return (
    <div
      data-wally-box={mode}
      onBlur={onBlur}
      // A press on the box's padding or hint would move focus to the page.
      onMouseDown={(e) => {
        if (!(e.target as HTMLElement).closest(OWN_CONTROLS)) e.preventDefault();
      }}
      className={cn(
        'flex w-full flex-col overflow-hidden rounded-[22px] border border-border bg-surface text-left shadow-e2',
        box.working && 'wally-ring',
      )}
    >
      {reply && (
        <div
          className="max-h-[40vh] overflow-y-auto border-b border-border-subtle px-4 pb-3 pt-3.5 animate-fade-in motion-reduce:animate-none"
          aria-live="polite"
        >
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              {(reply.kind === 'asking' || reply.kind === 'answer') && (
                <p className="mb-1.5 truncate text-12 text-fg-3">{reply.question}</p>
              )}
              {reply.kind === 'asking' && (
                <div className="flex flex-col gap-2" aria-busy>
                  <span role="status" className="sr-only">
                    {t('ask.asking')}
                  </span>
                  <Skeleton className="h-3.5 w-[90%]" />
                  <Skeleton className="h-3.5 w-[60%]" />
                </div>
              )}
              {reply.kind === 'answer' && (
                <BoxAnswer outcome={reply.outcome} notes={notes} onOpenNote={onOpenNote} />
              )}
              {reply.kind === 'duplicate' && (
                <>
                  <p className="text-14 text-fg-1">
                    {t('box.duplicate', { title: reply.note.title || t('common.untitled') })}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => box.choose({ action: 'open', noteId: reply.note.id })}
                    >
                      {t('box.openIt')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => box.choose({ action: 'addAnyway', text: reply.text })}
                    >
                      {t('box.addAnyway')}
                    </Button>
                  </div>
                </>
              )}
              {reply.kind === 'clarify' && (
                <>
                  <p className="text-14 text-fg-1">{reply.question}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {reply.options.map((option, i) => (
                      <Button
                        key={i}
                        size="sm"
                        variant={i === 0 ? 'default' : 'outline'}
                        onClick={() => box.choose(option)}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </div>
                </>
              )}
              {reply.kind === 'status' && (
                <p className="text-13 text-fg-3">{t(`box.${reply.message}`)}</p>
              )}
            </div>
            {reply.kind !== 'asking' && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('box.close')}
                onClick={box.closeReply}
              >
                <X />
              </Button>
            )}
          </div>
        </div>
      )}
      {box.pending.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 px-3 pt-2.5 pl-[52px]">
          {box.pending.map((item) => (
            <li
              key={item.id}
              aria-label={t('box.pendingAria', { text: item.text })}
              className="inline-flex h-6 max-w-[240px] items-center gap-1.5 rounded-full bg-inset px-2.5 text-12 text-fg-1"
            >
              <span className="flex gap-0.5" aria-hidden>
                <span className="capture-dot h-1 w-1 rounded-full bg-accent" />
                <span className="capture-dot h-1 w-1 rounded-full bg-accent [animation-delay:150ms]" />
                <span className="capture-dot h-1 w-1 rounded-full bg-accent [animation-delay:300ms]" />
              </span>
              <span className="truncate">{item.text}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-start gap-3 px-3 py-2.5">
        <BrandMark size={28} className="mt-px shrink-0" />
        <div className="max-h-24 min-w-0 flex-1 overflow-y-auto py-1">
          <MirroredField
            ref={setRefs}
            value={text}
            parse={withoutDropped(parse, chips)}
            onChange={(e) => {
              setText(e.target.value);
              if (!e.target.value.trim()) setPinned(null);
            }}
            onKeyDown={onFieldKey}
            aria-label={t('box.aria')}
            aria-describedby={showsHint ? hintId : undefined}
            placeholder={t(assistantEnabled ? 'box.placeholder' : 'box.placeholderNotesOnly')}
            maxLength={INTAKE_MESSAGE_MAX}
          />
        </div>
        {showsHint && (
          <span id={hintId} className="mt-1.5 shrink-0 text-12 text-fg-3">
            {hint}
            <span className="ml-1.5 hidden text-fg-faint md:inline">· {t('box.hintFlip')}</span>
          </span>
        )}
        <kbd className="mt-1.5 shrink-0 font-mono text-12 text-fg-faint [@media(pointer:coarse)]:hidden">
          ⏎
        </kbd>
      </div>
      {parse && (
        <div className="px-3 pb-2.5 pl-[52px]">
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
        </div>
      )}
      <span aria-live="polite" className="sr-only">
        {pinned ? t('box.pinned', { hint }) : ''}
      </span>
    </div>
  );
}
