import {
  foldFieldKey,
  notePriorityValues,
  type Language,
  type NoteColour,
  type BoardVisibilityFilter,
  type NoteDto,
  type NoteHorizon,
  type NotePriority,
} from '@wally/shared';
import type { BoardAxis, BoardViewState } from '../hooks/useBoardViewState';
import { enumLabels, type T } from '@/i18n/enumLabels';
import { parseIsoDate } from '@/i18n/dates';

export type DueTone = 'success' | 'danger' | 'warning' | 'neutral';

export interface DueInfo {
  label: string;
  tone: DueTone;
  weight: 400 | 500;
}

function dayDiff(iso: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${iso}T00:00:00`);
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

/**
 * `t` is threaded in rather than read off the i18n singleton, and that is deliberate: a
 * singleton read is invisible to useMemo, so ListView's `groups` memo would not recompute on a
 * language change and the board would sit there half-translated. react-i18next hands back a
 * NEW `t` reference after languageChanged, so callers that put `t` in their deps array are
 * self-correcting.
 *
 * The brand guideline names four states and no more — overdue, today, done, and everything
 * else — so "tomorrow" no longer gets a tone of its own; it reads as an ordinary future date
 * in taupe. Weight tops out at 500, the Meta spec, rather than the 600 this used to reach for.
 */
export function dueInfo(note: Pick<NoteDto, 'status' | 'dueDate'>, t: T): DueInfo {
  if (note.status === 'DONE') return { label: t('board.due.done'), tone: 'success', weight: 500 };
  if (!note.dueDate) return { label: t('board.due.none'), tone: 'neutral', weight: 400 };
  const date = parseIsoDate(note.dueDate);
  const diff = dayDiff(note.dueDate);
  if (diff < 0) return { label: t('board.due.overdue', { date }), tone: 'danger', weight: 500 };
  if (diff === 0) return { label: t('board.due.today'), tone: 'warning', weight: 500 };
  if (diff === 1) return { label: t('board.due.tomorrow'), tone: 'neutral', weight: 400 };
  return { label: t('common.shortDate', { date }), tone: 'neutral', weight: 400 };
}

/** Status colour is TEXT, in the due-date line and nowhere else — no badges, no tinted rows.
 * If you find yourself reaching for one of these as a `bg-`, the guideline says don't
 * (docs/BRAND.md); brandGuards.test.ts will stop you anyway. */
export const dueToneClass: Record<DueTone, string> = {
  success: 'text-status-success',
  danger: 'text-status-danger',
  warning: 'text-status-warning',
  neutral: 'text-fg-meta-on-note',
};

/**
 * A note is coloured all over, like paper — one fill per colour, used for the card, the list
 * row and the picker dot alike. There is no swatch/spine/tint split any more: the guideline
 * calls a stripe out by name ("full fill, not a stripe").
 *
 * Written out per colour rather than derived from noteColourValues on purpose: Tailwind only
 * emits an arbitrary-value class it can find as a literal string in the source, so a
 * template-built `bg-[color:var(--note-${c})]` would compile fine and then render no colour at
 * all. The Record type keeps it exhaustive.
 */
export const noteColourFillClass: Record<NoteColour, string> = {
  CHALK: 'bg-[color:var(--note-chalk)]',
  ICE: 'bg-[color:var(--note-ice)]',
  STONE: 'bg-[color:var(--note-stone)]',
  MINT: 'bg-[color:var(--note-mint)]',
  SKY: 'bg-[color:var(--note-sky)]',
  MIST: 'bg-[color:var(--note-mist)]',
  OAT: 'bg-[color:var(--note-oat)]',
  CLAY: 'bg-[color:var(--note-clay)]',
  ROSE: 'bg-[color:var(--note-rose)]',
  MALLOW: 'bg-[color:var(--note-mallow)]',
  HEATHER: 'bg-[color:var(--note-heather)]',
  SEA_GREEN: 'bg-[color:var(--note-sea-green)]',
  SAGE: 'bg-[color:var(--note-sage)]',
  OLIVE: 'bg-[color:var(--note-olive)]',
};

/** No manual per-zone ordering (see the plan's data-model decision) — zones auto-flow by
 * due date, undated notes last, then creation date as the tiebreaker. */
export function sortNotes(notes: NoteDto[]): NoteDto[] {
  return [...notes].sort((a, b) => {
    if (a.dueDate && b.dueDate) {
      if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    } else if (a.dueDate && !b.dueDate) {
      return -1;
    } else if (!a.dueDate && b.dueDate) {
      return 1;
    }
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  });
}

export interface NoteGroup<K extends string> {
  key: K;
  label: string;
  notes: NoteDto[];
}

const HORIZON_ORDER: NoteHorizon[] = ['TODAY', 'THIS_WEEK', 'LATER'];
const PRIORITY_ORDER: NotePriority[] = [...notePriorityValues];

/**
 * Where a new note goes on a zoned wall when no zone was chosen (N, New note): the first
 * horizon (TODAY), but the middle priority (MEDIUM, the schema default) rather than the first
 * band, so pressing N again and again never makes every note high priority.
 */
export function defaultZoneKey(axis: 'horizon' | 'priority'): NoteHorizon | NotePriority {
  return axis === 'horizon' ? HORIZON_ORDER[0]! : 'MEDIUM';
}

/** Groups + sorts notes by the active axis. Always returns one entry per zone (even
 * empty) so callers that need every band rendered (WallView's ZoneBands) don't have to
 * special-case it; ListView filters out empty groups itself per its own empty-state rule. */
export function groupByAxis(notes: NoteDto[], axis: BoardAxis, t: T): NoteGroup<string>[] {
  if (axis === 'free') {
    return [{ key: 'ALL', label: t('board.group.all'), notes: sortNotes(notes) }];
  }
  const labels = enumLabels(t);
  if (axis === 'priority') {
    return PRIORITY_ORDER.map((key) => ({
      key,
      label: labels.priority[key],
      notes: sortNotes(notes.filter((n) => n.priority === key)),
    }));
  }
  return HORIZON_ORDER.map((key) => ({
    key,
    label: labels.horizon[key],
    notes: sortNotes(notes.filter((n) => n.horizon === key)),
  }));
}

/** Every custom-property key used anywhere on the board, for the filter bar and the
 * note editor's key autocomplete. De-duplicated through the shared, locale-neutral fold
 * (`foldFieldKey`), first spelling wins; sorted for a reader of `language`. */
export function collectFieldKeys(notes: NoteDto[], language: Language): string[] {
  const byFolded = new Map<string, string>();
  for (const note of notes) {
    for (const key of Object.keys(note.customFields ?? {})) {
      const folded = foldFieldKey(key);
      if (!byFolded.has(folded)) byFolded.set(folded, key);
    }
  }
  return [...byFolded.values()].sort((a, b) => a.localeCompare(b, language));
}

/** The distinct values recorded for one property across the board, sorted for a reader of
 * `language`. */
export function collectFieldValues(notes: NoteDto[], key: string, language: Language): string[] {
  const folded = foldFieldKey(key);
  const values = new Set<string>();
  for (const note of notes) {
    for (const [k, v] of Object.entries(note.customFields ?? {})) {
      if (foldFieldKey(k) === folded) values.add(v);
    }
  }
  return [...values].sort((a, b) => a.localeCompare(b, language));
}

export function filterNotes(
  notes: NoteDto[],
  view: BoardViewState,
  currentUserId: string | undefined,
): NoteDto[] {
  const q = view.q.trim().toLowerCase();
  // The same locale-neutral fold the API's `?field=` filter uses, so both agree for everyone.
  const fieldKey = view.fieldKey ? foldFieldKey(view.fieldKey) : undefined;
  const fieldValue = view.fieldValue?.toLowerCase();
  return notes.filter((n) => {
    if (!view.done && n.status === 'DONE') return false;
    if (view.mine && n.assignee?.id !== currentUserId) return false;
    if (view.visibility === 'private' && n.visibility !== 'PRIVATE') return false;
    if (view.visibility === 'shared' && n.visibility === 'PRIVATE') return false;
    if (view.priority.length && !view.priority.includes(n.priority)) return false;
    if (fieldKey) {
      const match = Object.entries(n.customFields ?? {}).some(
        ([k, v]) => foldFieldKey(k) === fieldKey && (!fieldValue || v.toLowerCase() === fieldValue),
      );
      if (!match) return false;
    }
    if (q) {
      const fields = Object.entries(n.customFields ?? {})
        .map(([k, v]) => `${k} ${v}`)
        .join(' ');
      const haystack = `${n.title} ${n.description} ${fields} ${n.tags.join(' ')}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

export function subtaskCountLabel(summary: { done: number; total: number }): string {
  return summary.total ? `${summary.done}/${summary.total}` : '';
}

/**
 * Up to two initials. A user with no display name is shown by email, and the local part is
 * split on the usual separators, so `milad.rezazadeh@…` reads "MR" rather than a lone "M".
 */
export function initialsOf(name: string): string {
  const at = name.indexOf('@');
  const words = at > 0 ? name.slice(0, at).split(/[._-]+/) : name.split(' ');
  return words
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function displayName(
  user: { email: string; displayName: string | null } | null | undefined,
): string {
  if (!user) return '';
  return user.displayName ?? user.email;
}

/** The chips appear once there is something to filter, and stay while a filter is on so
 *  it can always be switched off again. */
export function showsVisibilityFilter(
  notes: Pick<NoteDto, 'visibility'>[],
  filter: BoardVisibilityFilter,
): boolean {
  return filter !== 'all' || notes.some((n) => n.visibility === 'PRIVATE');
}

/**
 * What a note is related to, both ways (the plan's L1, L6): the notes it links to, in its own
 * order, then the notes that link to it. Resolved against the board's notes, so an id whose
 * note is gone or out of sight is dropped (L7).
 */
export function relatedNotes(
  note: Pick<NoteDto, 'id' | 'links'>,
  notes: readonly NoteDto[],
): { note: NoteDto; direction: 'out' | 'in' }[] {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const out = note.links.flatMap((id) => {
    const target = byId.get(id);
    return target ? [{ note: target, direction: 'out' as const }] : [];
  });
  const seen = new Set(note.links);
  const incoming = notes
    .filter((n) => n.id !== note.id && n.links.includes(note.id) && !seen.has(n.id))
    .map((n) => ({ note: n, direction: 'in' as const }));
  return [...out, ...incoming];
}

/**
 * How many notes each note of the board is related to: `relatedNotes(note, notes).length` for
 * every note at once, in one pass over the links rather than one per card. The card and the
 * row show this count (L5), so a deleted or private-made target is not counted (L7) and a
 * note that is only linked to counts its backlinks (L1).
 */
export function relatedCounts(notes: readonly NoteDto[]): Map<string, number> {
  const ids = new Set(notes.map((n) => n.id));
  const linkedFrom = new Map<string, Set<string>>();
  for (const source of notes) {
    for (const id of source.links) {
      if (id === source.id || !ids.has(id)) continue;
      const sources = linkedFrom.get(id) ?? new Set<string>();
      sources.add(source.id);
      linkedFrom.set(id, sources);
    }
  }
  const counts = new Map<string, number>();
  for (const note of notes) {
    const own = new Set(note.links);
    const out = note.links.filter((id) => ids.has(id)).length;
    let incoming = 0;
    for (const source of linkedFrom.get(note.id) ?? []) if (!own.has(source)) incoming += 1;
    if (out + incoming > 0) counts.set(note.id, out + incoming);
  }
  return counts;
}
