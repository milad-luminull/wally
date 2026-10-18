import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUp, X } from 'lucide-react';
import type { AssistantConversationDto, AssistantEntry } from '@wally/shared';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { IconTooltip } from '@/components/ui/tooltip';
import { useQueryKeys } from '../hooks/queryKeys';
import { useNotes } from '../hooks/useNotes';
import { AnswerNotes } from '../Ask/AnswerNotes';
import { useAskAssistant, type AskOutcome } from '../Ask/useAskAssistant';
import { useAssistantConversation } from './useAssistantConversation';

const EXAMPLES = ['open', 'overdue', 'busiest'] as const;
/** The longest question the API accepts (assistantTurnRequestSchema). */
const MAX_QUESTION_LENGTH = 2000;

interface Exchange {
  question: string;
  answer: AssistantEntry | null;
  outcome: Exclude<AskOutcome, { kind: 'answered' }> | null;
}

/** Pairs the stored entries into exchanges, newest first. */
function exchangesOf(conversation: AssistantConversationDto | null | undefined): Exchange[] {
  if (!conversation) return [];
  const out: Exchange[] = [];
  const { entries } = conversation;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    if (e.role !== 'user') continue;
    const next = entries[i + 1];
    out.push({
      question: e.text,
      answer: next && next.role === 'assistant' ? next : null,
      outcome: null,
    });
  }
  return out.reverse();
}

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

export function AssistantContent({
  boardId,
  onClose,
  onOpenNote,
  autoFocus,
}: {
  boardId: string;
  onClose: () => void;
  onOpenNote: (noteId: string) => void;
  autoFocus: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { data: stored } = useAssistantConversation(boardId, true);
  const { data: notes } = useNotes(boardId);
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  const ask = useAskAssistant(boardId);
  const [isPending, setIsPending] = useState(false);
  const [draft, setDraft] = useState('');
  const [fresh, setFresh] = useState(false);
  const [pending, setPending] = useState<Exchange | null>(null);
  // The latest exchange becomes a live region only once a question is asked here, so opening
  // the panel on a restored conversation announces nothing.
  const [asked, setAsked] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) fieldRef.current?.focus();
  }, [autoFocus]);

  // One to four lines, grown by content; max-h caps it and the field scrolls past that.
  // The border is added back because scrollHeight leaves it out under border-box.
  useEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [draft]);

  // The field is disabled while a turn runs, which drops its focus. When the turn settles,
  // focus goes back to the field so a follow-up is one keystroke away, but only when focus
  // went nowhere in between (on body or still on the field); a click elsewhere wins.
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !isPending) {
      const active = document.activeElement;
      if (!active || active === document.body || active === fieldRef.current) {
        fieldRef.current?.focus();
      }
    }
    wasPending.current = isPending;
  }, [isPending]);

  const conversation = fresh ? null : (stored ?? null);
  const exchanges = useMemo(() => exchangesOf(conversation), [conversation]);

  async function submit(text: string) {
    const message = text.trim();
    if (!message || isPending) return;
    // The field empties at once: while the turn runs the question shows above the answer
    // slot, not twice. A refused or failed ask puts it back, so trying again is one keystroke.
    setDraft('');
    setAsked(true);
    setPending({ question: message, answer: null, outcome: null });
    setIsPending(true);
    const outcome = await ask(message, conversation?.id ?? null).finally(() => setIsPending(false));
    if (outcome.kind === 'answered') {
      queryClient.setQueryData(keys.assistantLatest(boardId), outcome.conversation);
      setFresh(false);
      setPending(null);
    } else {
      setDraft(message);
      setPending({ question: message, answer: null, outcome });
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter that confirms an input method's composition is not a question.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit(draft);
    }
  }

  const [latest, ...earlier] = pending ? [pending, ...exchanges] : exchanges;
  const loading = pending !== null && pending.outcome === null;
  // A conversation whose first turn failed has no entries yet. It shows like no conversation
  // at all (examples, no "New"), while its id still goes with the next ask so it is continued.
  const hasExchanges = exchanges.length > 0;
  const showNew = hasExchanges && !loading;
  // The examples wait for the latest conversation to resolve (null means there is none), so
  // they never flash in above a conversation that is still loading or failed to load.
  const showExamples = !latest && (fresh || (stored !== undefined && !hasExchanges));

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <h2 className="flex-1 text-16 font-semibold text-fg-1">{t('assistant.title')}</h2>
        {showNew && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFresh(true);
              setPending(null);
              fieldRef.current?.focus();
            }}
          >
            {t('assistant.newConversation')}
          </Button>
        )}
        <IconTooltip label={t('common.close')} shortcut={['Esc']}>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t('common.close')}>
            <X />
          </Button>
        </IconTooltip>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="relative">
          <Textarea
            ref={fieldRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('assistant.placeholder')}
            rows={1}
            maxLength={MAX_QUESTION_LENGTH}
            disabled={isPending}
            aria-label={t('assistant.fieldAria')}
            className="min-h-9 max-h-24 pr-9"
          />
          <IconTooltip label={t('assistant.ask')} shortcut={['↵']}>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => void submit(draft)}
              disabled={isPending || !draft.trim()}
              aria-label={t('assistant.ask')}
              className="absolute bottom-1 right-1"
            >
              <ArrowUp />
            </Button>
          </IconTooltip>
        </div>

        {showExamples && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {EXAMPLES.map((key) => (
              <Button
                key={key}
                variant="outline"
                size="sm"
                onClick={() => void submit(t(`assistant.examples.${key}`))}
              >
                {t(`assistant.examples.${key}`)}
              </Button>
            ))}
          </div>
        )}

        {/* After a question is asked here, the latest exchange is a polite live region, so the
            answer or refusal is announced when it arrives; aria-busy holds the announcement
            back while the turn runs. */}
        <div aria-live={asked ? 'polite' : undefined} aria-busy={asked ? loading : undefined}>
          {latest && (
            <ExchangeView
              exchange={latest}
              notes={notes}
              onOpenNote={onOpenNote}
              locale={i18n.language}
              loading={loading}
            />
          )}
        </div>

        {earlier.length > 0 && (
          <section className="mt-6">
            <p className="mb-2 text-12 font-medium text-fg-3">{t('assistant.earlier')}</p>
            {earlier.map((exchange, index) => (
              <div
                key={`${exchange.answer?.at ?? ''}-${index}`}
                className="border-t border-border-subtle py-3"
              >
                <ExchangeView
                  exchange={exchange}
                  notes={notes}
                  onOpenNote={onOpenNote}
                  locale={i18n.language}
                  loading={false}
                />
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

function ExchangeView({
  exchange,
  notes,
  onOpenNote,
  locale,
  loading,
}: {
  exchange: Exchange;
  notes: Parameters<typeof AnswerNotes>[0]['notes'];
  onOpenNote: (noteId: string) => void;
  locale: string;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const { answer, outcome } = exchange;
  let outcomeLine: string | null = null;
  if (outcome?.kind === 'failed') outcomeLine = t('assistant.failed');
  else if (outcome?.kind === 'refused') {
    const daily = outcome.code === 'ASSISTANT_DAILY_CAP';
    const when =
      outcome.code !== 'ASSISTANT_BUSY' && outcome.resetsAt
        ? formatWhen(outcome.resetsAt, locale, daily)
        : null;
    outcomeLine = !when
      ? t('assistant.limit.busy')
      : daily
        ? t('assistant.limit.daily', { when })
        : t('assistant.limit.monthly', { when });
  }
  return (
    <div className="mt-4">
      <p className="whitespace-pre-line text-13 text-fg-3">{exchange.question}</p>
      {loading && (
        <div className="mt-2 flex flex-col gap-2">
          <Skeleton className="h-3.5 w-[90%]" />
          <Skeleton className="h-3.5 w-[60%]" />
        </div>
      )}
      {outcomeLine && <p className="mt-2 text-13 text-fg-3">{outcomeLine}</p>}
      {answer && (
        <>
          {answer.text && (
            <p className="mt-2 whitespace-pre-line text-14 text-fg-1">{answer.text}</p>
          )}
          {answer.stopped && (
            <p className="mt-2 text-12 text-fg-3">{t(`assistant.stopped.${answer.stopped}`)}</p>
          )}
          {answer.partial && <p className="mt-1 text-12 text-fg-3">{t('assistant.partial')}</p>}
          <AnswerNotes chips={answer.chips} notes={notes} onOpenNote={onOpenNote} />
        </>
      )}
    </div>
  );
}
