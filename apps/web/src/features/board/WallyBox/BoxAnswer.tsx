import { useTranslation } from 'react-i18next';
import type { NoteDto } from '@wally/shared';
import { formatWhen } from '@/lib/formatWhen';
import { AnswerNotes } from '../Ask/AnswerNotes';
import type { AskOutcome } from '../Ask/useAskAssistant';

/**
 * An answer in the box: its words, the notes it read listed underneath (BRAND.md AI rule 8),
 * or the one line that says why there is none (a limit, busy, a failure).
 */
export function BoxAnswer({
  outcome,
  notes,
  onOpenNote,
}: {
  outcome: AskOutcome;
  notes: NoteDto[] | undefined;
  onOpenNote: (noteId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  if (outcome.kind === 'failed') return <p className="text-13 text-fg-3">{t('ask.failed')}</p>;
  if (outcome.kind === 'refused') {
    const daily = outcome.code === 'ASSISTANT_DAILY_CAP';
    const when =
      outcome.code !== 'ASSISTANT_BUSY' && outcome.resetsAt
        ? formatWhen(outcome.resetsAt, i18n.language, daily)
        : null;
    return (
      <p className="text-13 text-fg-3">
        {!when
          ? t('ask.limit.busy')
          : daily
            ? t('ask.limit.daily', { when })
            : t('ask.limit.monthly', { when })}
      </p>
    );
  }
  const answer = outcome.conversation.entries.findLast((e) => e.role === 'assistant');
  const rows = answer
    ? notes
      ? answer.chips.filter((chip) => notes.some((n) => n.id === chip.id))
      : answer.chips
    : [];
  // No words and no notes left to show is said as a failure, with why when the API knows.
  if (!answer || (!answer.text.trim() && rows.length === 0))
    return (
      <p className="text-13 text-fg-3">
        {answer?.stopped === 'TIMEOUT' || answer?.stopped === 'TOOL_LIMIT'
          ? t(`ask.stopped.${answer.stopped}`)
          : t('ask.failed')}
      </p>
    );
  return (
    <>
      {answer.text && (
        <p className="whitespace-pre-line text-14 leading-snug text-fg-1">{answer.text}</p>
      )}
      {answer.stopped && (
        <p className="mt-1 text-12 text-fg-3">{t(`ask.stopped.${answer.stopped}`)}</p>
      )}
      {answer.partial && <p className="mt-1 text-12 text-fg-3">{t('ask.partial')}</p>}
      <AnswerNotes chips={answer.chips} notes={notes} onOpenNote={onOpenNote} />
    </>
  );
}
