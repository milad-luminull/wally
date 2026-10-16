import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp, X } from 'lucide-react';
import type { AssistantConversationDto, AssistantEntry } from '@wally/shared';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { IconTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { useNotes } from '../hooks/useNotes';
import { AnswerNotes } from './AnswerNotes';
import { useAskAssistant, type AskOutcome } from './useAskAssistant';
import { useAssistantConversation } from './useAssistantConversation';

const EXAMPLES = ['open', 'overdue', 'busiest'] as const;

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

function formatWhen(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
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
  const { ask, isPending } = useAskAssistant(boardId);
  const [draft, setDraft] = useState('');
  const [fresh, setFresh] = useState(false);
  const [pending, setPending] = useState<Exchange | null>(null);
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

  const conversation = fresh ? null : (stored ?? null);
  const exchanges = useMemo(() => exchangesOf(conversation), [conversation]);

  async function submit(text: string) {
    const message = text.trim();
    if (!message || isPending) return;
    setDraft('');
    setPending({ question: message, answer: null, outcome: null });
    const outcome = await ask(message, conversation?.id ?? null);
    if (outcome.kind === 'answered') {
      setFresh(false);
      setPending(null);
    } else {
      setPending({ question: message, answer: null, outcome });
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit(draft);
    }
  }

  const [latest, ...earlier] = pending ? [pending, ...exchanges] : exchanges;
  const showNew = Boolean(conversation) && !pending;

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
            disabled={isPending}
            aria-label={t('assistant.ask')}
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

        {!latest && (
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

        {latest && (
          <ExchangeView
            exchange={latest}
            notes={notes ?? []}
            onOpenNote={onOpenNote}
            locale={i18n.language}
            loading={pending !== null && pending.outcome === null}
          />
        )}

        {earlier.length > 0 && (
          <section className="mt-6">
            <p className="mb-2 text-12 font-medium text-fg-3">{t('assistant.earlier')}</p>
            {earlier.map((exchange, index) => (
              <div key={index} className={cn('border-t border-border-subtle py-3', 'opacity-80')}>
                <ExchangeView
                  exchange={exchange}
                  notes={notes ?? []}
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
  return (
    <div className="mt-4">
      <p className="text-13 text-fg-3">{exchange.question}</p>
      {loading && (
        <div className="mt-2 flex flex-col gap-2" aria-busy>
          <Skeleton className="h-3.5 w-[90%]" />
          <Skeleton className="h-3.5 w-[60%]" />
        </div>
      )}
      {outcome && (
        <p className="mt-2 text-13 text-fg-3">
          {outcome.kind === 'failed'
            ? t('assistant.failed')
            : outcome.code === 'ASSISTANT_BUSY' || !outcome.resetsAt
              ? t('assistant.limit.busy')
              : t(
                  outcome.code === 'ASSISTANT_DAILY_CAP'
                    ? 'assistant.limit.daily'
                    : 'assistant.limit.monthly',
                  {
                    when: formatWhen(outcome.resetsAt, locale),
                  },
                )}
        </p>
      )}
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
