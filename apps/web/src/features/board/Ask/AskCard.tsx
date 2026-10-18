import { useEffect, useRef, type FocusEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Pin, PinOff, X } from 'lucide-react';
import type { NoteDto } from '@wally/shared';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { IconTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { noteColourFillClass } from '../util/noteDerived';
import { AnswerNotes } from './AnswerNotes';
import type { AskSession } from './useAskSession';

/** Wider than a note: an answer is a paragraph, a note is a line (plan R3). */
export const ASK_CARD_WIDTH = 376;
/** A tall answer's height, an estimate: the room it is given on the canvas and kept clear of new notes. */
export const ASK_CARD_MAX_HEIGHT = 320;
/** The board's own surface (AppShell), where the focus goes when the card leaves with it. */
const BOARD_SURFACE = '[data-board-surface]';

/** The reset moment for a cap line: date and time for the daily cap, the date alone for the
 *  monthly one. Null when the API sent something that does not parse, so the busy line shows. */
function formatWhen(iso: string, locale: string, withTime: boolean): string | null {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  return new Intl.DateTimeFormat(
    locale,
    withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' },
  ).format(at);
}

/**
 * The answer to a question typed into the capture card, drawn where the question was written
 * (WALLYBOT_INLINE.md §3.6): the note's type, the pending look's dashed edge and nothing else,
 * the notes it relied on as rows underneath. Its own component, as the capture card is: it is
 * never a note, never dragged, and it fades. No dot and no ring: nothing is written (R3).
 */
export function AskCard({
  session,
  notes,
  layout,
  onOpenNote,
  onSetPinned,
  onDismiss,
  onPause,
}: {
  session: AskSession;
  /** The board's notes, so the rows read like the list and a note gone from the board is dropped. */
  notes: NoteDto[] | undefined;
  layout: 'card' | 'row';
  onOpenNote: (noteId: string) => void;
  onSetPinned: (pinned: boolean) => void;
  onDismiss: () => void;
  /** Hover or focus on the card holds the fade (R5). */
  onPause: (paused: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const hovered = useRef(false);
  const focused = useRef(false);
  /** True while the card takes the focus itself on mount: that focus is not the person's, so it
   *  must not hold the clock, or the answer would never fade on its own (R5 with R8). */
  const takingFocus = useRef(false);

  // The capture card gave way to this one with Enter and left the focus on the page: the card
  // takes it, so Esc, the pin, the × and the rows work from the keyboard (R8). A question
  // settled by a blur, and focus the person put somewhere else meanwhile, are left alone.
  const takeFocus = session.takeFocus;
  useEffect(() => {
    if (!takeFocus) return;
    const active = document.activeElement;
    if (!active || active === document.body || active.matches(BOARD_SURFACE)) {
      takingFocus.current = true;
      try {
        rootRef.current?.focus();
      } finally {
        takingFocus.current = false;
      }
    }
    // On mount: the flag is the session's, and a card lives for one session.
  }, [takeFocus]);
  // Going away with the focus inside, the card hands it to the board, never to the page. The
  // browser has already moved the focus to the body by the time this runs, so that is the sign.
  useEffect(
    () => () => {
      const active = document.activeElement;
      if (!active || active === document.body)
        document.querySelector<HTMLElement>(BOARD_SURFACE)?.focus();
    },
    [],
  );

  /** Hover and focus are tracked apart, so leaving one while the other holds lets nothing go. */
  function hold(source: 'hover' | 'focus', value: boolean) {
    const before = hovered.current || focused.current;
    (source === 'hover' ? hovered : focused).current = value;
    const after = hovered.current || focused.current;
    if (after !== before) onPause(after);
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onDismiss();
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      // The board's single keys (N, V, G…) would open or switch something under the card.
      event.stopPropagation();
    }
  }
  function onBlur(event: FocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    hold('focus', false);
  }

  const { phase, answer, refusal } = session;
  let outcomeLine: string | null = null;
  if (phase === 'failed') outcomeLine = t('ask.failed');
  else if (phase === 'refused' && refusal) {
    const daily = refusal.code === 'ASSISTANT_DAILY_CAP';
    const when =
      refusal.code !== 'ASSISTANT_BUSY' && refusal.resetsAt
        ? formatWhen(refusal.resetsAt, i18n.language, daily)
        : null;
    outcomeLine = !when
      ? t('ask.limit.busy')
      : daily
        ? t('ask.limit.daily', { when })
        : t('ask.limit.monthly', { when });
  }
  const pinLabel = t(session.pinned ? 'ask.unpin' : 'ask.pin');

  return (
    <div
      ref={rootRef}
      role="group"
      tabIndex={-1}
      aria-label={t('ask.cardAria')}
      data-ask-card
      data-ask-phase={phase}
      onKeyDown={onKeyDown}
      onMouseEnter={() => hold('hover', true)}
      onMouseLeave={() => hold('hover', false)}
      onFocus={() => {
        if (!takingFocus.current) hold('focus', true);
      }}
      onBlur={onBlur}
      className={cn(
        'relative flex flex-col gap-2 rounded-lg border border-dashed border-[color:var(--note-border)] p-3 text-left shadow-e2 outline-none',
        'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--note-selected)]',
        noteColourFillClass.WEISS,
        layout === 'card' ? 'w-[376px] max-w-full' : 'w-full',
        // 180 ms of opacity, then the shell removes the card; nothing moves under reduced motion.
        phase === 'fading' &&
          'animate-fade-out [animation-fill-mode:forwards] motion-reduce:invisible motion-reduce:animate-none',
      )}
    >
      <div className="flex items-start gap-1">
        <p className="min-w-0 flex-1 whitespace-pre-line pt-1 text-14 font-medium leading-snug text-fg-1">
          {session.question}
        </p>
        <IconTooltip label={pinLabel}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-pressed={session.pinned}
            aria-label={pinLabel}
            onClick={() => onSetPinned(!session.pinned)}
          >
            {session.pinned ? <PinOff /> : <Pin />}
          </Button>
        </IconTooltip>
        <IconTooltip label={t('ask.close')} shortcut={['Esc']}>
          <Button variant="ghost" size="icon-sm" aria-label={t('ask.close')} onClick={onDismiss}>
            <X />
          </Button>
        </IconTooltip>
      </div>

      {/* A polite live region: the answer, a refusal or a failure is announced when it lands;
          aria-busy holds the announcement back while the wall is being read. */}
      <div aria-live="polite" aria-busy={phase === 'asking'}>
        {phase === 'asking' && (
          <div className="flex flex-col gap-2">
            <span className="sr-only">{t('ask.asking')}</span>
            <Skeleton className="h-3.5 w-[90%]" />
            <Skeleton className="h-3.5 w-[60%]" />
          </div>
        )}
        {outcomeLine && <p className="text-13 text-fg-3">{outcomeLine}</p>}
        {answer && (
          <>
            {answer.text && (
              <p className="whitespace-pre-line text-13 leading-snug text-fg-1">{answer.text}</p>
            )}
            {answer.stopped && (
              <p className="mt-1 text-12 text-fg-3">{t(`ask.stopped.${answer.stopped}`)}</p>
            )}
            {answer.partial && <p className="mt-1 text-12 text-fg-3">{t('ask.partial')}</p>}
            <AnswerNotes
              chips={answer.chips}
              notes={notes}
              onOpenNote={(noteId) => {
                // Reading a note the answer relied on keeps the answer there to come back to (R6).
                onSetPinned(true);
                onOpenNote(noteId);
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
