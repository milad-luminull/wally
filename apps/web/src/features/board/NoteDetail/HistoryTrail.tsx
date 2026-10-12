import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HistoryEventDto } from '@wally/shared';
import type { T } from '@/i18n/enumLabels';
import { displayName } from '../util/noteDerived';
import { FieldLabel } from './Field';

const VISIBLE_BY_DEFAULT = 3;

function actionKey(event: HistoryEventDto) {
  if (event.type !== 'CREATED') return 'note.history.moved' as const;
  return event.metadata?.duplicatedFrom
    ? ('note.history.duplicated' as const)
    : ('note.history.created' as const);
}

function eventText(event: HistoryEventDto, t: T): { action: string; who: string; when: string } {
  return {
    action: t(actionKey(event)),
    who: event.actor ? displayName(event.actor) : t('note.history.someone'),
    // occurredAt is a real timestamp with a zone, so it is parsed directly — parseIsoDate is
    // only for bare calendar dates.
    when: t('common.shortDate', { date: new Date(event.occurredAt) }),
  };
}

/**
 * Read-only — SPEC §10: history is informational, no version restoration.
 *
 * Rendered as a dated list rather than one run-on sentence: a note moved five times used
 * to print five near-identical clauses joined by middots, which read as debug output. Only
 * the most recent few are shown until the user asks for the rest.
 */
export function HistoryTrail({ history }: { history: HistoryEventDto[] }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  if (history.length === 0) return null;

  const ordered = [...history].reverse();
  const visible = expanded ? ordered : ordered.slice(0, VISIBLE_BY_DEFAULT);
  const hiddenCount = ordered.length - visible.length;

  return (
    <div className="flex flex-col gap-2">
      <FieldLabel>{t('note.history.label')}</FieldLabel>
      <ul className="flex flex-col gap-1">
        {visible.map((event, index) => {
          const { action, who, when } = eventText(event, t);
          return (
            <li
              key={`${event.occurredAt}-${index}`}
              className="flex items-center gap-2 text-12 text-fg-3"
            >
              <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-border-strong" />
              <span className="shrink-0 text-fg-1">{action}</span>
              <span className="min-w-0 flex-1 truncate">{who}</span>
              <span className="shrink-0 tabular-nums text-fg-faint">{when}</span>
            </li>
          );
        })}
      </ul>

      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          /* Standalone control, not a link inside a sentence, so SC 2.5.8's inline exception
             does not cover it — the negative margin keeps the 12px text optically aligned
             with the list above while the target itself clears 24px. */
          className="-mx-1.5 -my-1 self-start rounded-sm px-1.5 py-1 text-12 font-medium text-fg-muted underline-offset-4 transition-colors duration-150 hover:text-fg-1 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)] [@media(pointer:coarse)]:-my-2 [@media(pointer:coarse)]:py-2.5"
        >
          {t('note.history.showMore', { count: hiddenCount })}
        </button>
      )}
    </div>
  );
}
