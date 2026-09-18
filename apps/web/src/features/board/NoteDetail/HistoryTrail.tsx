import type { HistoryEventDto } from '@wally/shared';
import { displayName } from '../util/noteDerived';

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}

function eventText(event: HistoryEventDto): string {
  const who = event.actor ? displayName(event.actor) : 'Jemand';
  const when = formatDateTime(event.occurredAt);
  if (event.type === 'CREATED') return `Angelegt von ${who} am ${when}`;
  return `Verschoben von ${who} am ${when}`;
}

/** Read-only — SPEC §10: history is informational, no version restoration. */
export function HistoryTrail({ history }: { history: HistoryEventDto[] }) {
  if (history.length === 0) return null;
  return (
    <p className="text-12 leading-relaxed text-fg-3">{history.map(eventText).join(' · ')}</p>
  );
}
