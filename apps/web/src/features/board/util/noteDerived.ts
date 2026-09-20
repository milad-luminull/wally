import {
  notePriorityValues,
  type NoteColour,
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
  weight: 400 | 500 | 600;
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
 * Mirrors the mockup's urgency ladder, but expressed as design-system status tones
 * (see globals.css) instead of raw hex, so it stays theme-able and consistent with the
 * priority-dot recolouring the plan calls for. */
export function dueInfo(note: Pick<NoteDto, 'status' | 'dueDate'>, t: T): DueInfo {
  if (note.status === 'DONE') return { label: t('board.due.done'), tone: 'success', weight: 500 };
  if (!note.dueDate) return { label: t('board.due.none'), tone: 'neutral', weight: 400 };
  const date = parseIsoDate(note.dueDate);
  const diff = dayDiff(note.dueDate);
  if (diff < 0) return { label: t('board.due.overdue', { date }), tone: 'danger', weight: 600 };
  if (diff === 0) return { label: t('board.due.today'), tone: 'warning', weight: 600 };
  if (diff === 1) return { label: t('board.due.tomorrow'), tone: 'warning', weight: 500 };
  return { label: t('common.shortDate', { date }), tone: 'neutral', weight: 400 };
}

export const dueToneClass: Record<DueTone, string> = {
  success: 'text-status-success',
  danger: 'text-status-danger',
  warning: 'text-[color:var(--status-warning)]',
  neutral: 'text-fg-muted',
};

export const priorityToneClass: Record<NotePriority, string> = {
  HOCH: 'bg-[color:var(--status-danger-bold)]',
  MITTEL: 'bg-[color:var(--status-warning-bold)]',
  NIEDRIG: 'bg-[color:var(--status-neutral-bold)]',
};

/** 14 swatches — Apricot intentionally excluded, see packages/shared's noteColourValues
 * comment (apricot stays functional-only).
 *
 * These four maps are written out per colour rather than derived from noteColourValues on
 * purpose: Tailwind only emits an arbitrary-value class it can find as a literal string in
 * the source, so a template-built `bg-[color:var(--note-${c})]` would compile fine and then
 * render no colour at all. The Record type keeps them exhaustive. */
export const noteColourBorderClass: Record<NoteColour, string> = {
  WEISS: 'border-l-border',
  EIS: 'border-l-[color:var(--note-eis)]',
  SAND: 'border-l-[color:var(--note-sand)]',
  MINZE: 'border-l-[color:var(--note-minze)]',
  HIMMEL: 'border-l-[color:var(--note-himmel)]',
  NEBEL: 'border-l-[color:var(--note-nebel)]',
  BUTTER: 'border-l-[color:var(--note-butter)]',
  LEHM: 'border-l-[color:var(--note-lehm)]',
  ROSE: 'border-l-[color:var(--note-rose)]',
  MALVE: 'border-l-[color:var(--note-malve)]',
  FLIEDER: 'border-l-[color:var(--note-flieder)]',
  SEEGRUEN: 'border-l-[color:var(--note-seegruen)]',
  SALBEI: 'border-l-[color:var(--note-salbei)]',
  OLIV: 'border-l-[color:var(--note-oliv)]',
};

/** Paper-weight card fill per note colour (see globals.css). The saturated swatch value
 * stays on the spine and the picker dot; the card body gets the tint, so a coloured note
 * reads as coloured paper without dropping text contrast. */
export const noteColourTintClass: Record<NoteColour, string> = {
  WEISS: 'bg-[color:var(--note-tint-weiss)]',
  EIS: 'bg-[color:var(--note-tint-eis)]',
  SAND: 'bg-[color:var(--note-tint-sand)]',
  MINZE: 'bg-[color:var(--note-tint-minze)]',
  HIMMEL: 'bg-[color:var(--note-tint-himmel)]',
  NEBEL: 'bg-[color:var(--note-tint-nebel)]',
  BUTTER: 'bg-[color:var(--note-tint-butter)]',
  LEHM: 'bg-[color:var(--note-tint-lehm)]',
  ROSE: 'bg-[color:var(--note-tint-rose)]',
  MALVE: 'bg-[color:var(--note-tint-malve)]',
  FLIEDER: 'bg-[color:var(--note-tint-flieder)]',
  SEEGRUEN: 'bg-[color:var(--note-tint-seegruen)]',
  SALBEI: 'bg-[color:var(--note-tint-salbei)]',
  OLIV: 'bg-[color:var(--note-tint-oliv)]',
};

/** The card's left spine — the strongest, most scannable carrier of the note colour. */
export const noteColourSpineClass: Record<NoteColour, string> = {
  WEISS: 'bg-border-strong',
  EIS: 'bg-[color:var(--note-eis)]',
  SAND: 'bg-[color:var(--note-sand)]',
  MINZE: 'bg-[color:var(--note-minze)]',
  HIMMEL: 'bg-[color:var(--note-himmel)]',
  NEBEL: 'bg-[color:var(--note-nebel)]',
  BUTTER: 'bg-[color:var(--note-butter)]',
  LEHM: 'bg-[color:var(--note-lehm)]',
  ROSE: 'bg-[color:var(--note-rose)]',
  MALVE: 'bg-[color:var(--note-malve)]',
  FLIEDER: 'bg-[color:var(--note-flieder)]',
  SEEGRUEN: 'bg-[color:var(--note-seegruen)]',
  SALBEI: 'bg-[color:var(--note-salbei)]',
  OLIV: 'bg-[color:var(--note-oliv)]',
};

export const noteColourSwatchClass: Record<NoteColour, string> = {
  WEISS: 'bg-white',
  EIS: 'bg-[color:var(--note-eis)]',
  SAND: 'bg-[color:var(--note-sand)]',
  MINZE: 'bg-[color:var(--note-minze)]',
  HIMMEL: 'bg-[color:var(--note-himmel)]',
  NEBEL: 'bg-[color:var(--note-nebel)]',
  BUTTER: 'bg-[color:var(--note-butter)]',
  LEHM: 'bg-[color:var(--note-lehm)]',
  ROSE: 'bg-[color:var(--note-rose)]',
  MALVE: 'bg-[color:var(--note-malve)]',
  FLIEDER: 'bg-[color:var(--note-flieder)]',
  SEEGRUEN: 'bg-[color:var(--note-seegruen)]',
  SALBEI: 'bg-[color:var(--note-salbei)]',
  OLIV: 'bg-[color:var(--note-oliv)]',
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

const HORIZON_ORDER: NoteHorizon[] = ['HEUTE', 'DIESE_WOCHE', 'SPAETER'];
const PRIORITY_ORDER: NotePriority[] = [...notePriorityValues];

/** Groups + sorts notes by the active axis. Always returns one entry per zone (even
 * empty) so callers that need every band rendered (WandView's ZoneBands) don't have to
 * special-case it; ListView filters out empty groups itself per its own empty-state rule. */
export function groupByAxis(notes: NoteDto[], axis: BoardAxis, t: T): NoteGroup<string>[] {
  if (axis === 'free') {
    return [{ key: 'ALLE', label: t('board.group.all'), notes: sortNotes(notes) }];
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
 * note editor's key autocomplete. Case-insensitively de-duplicated, first spelling wins. */
export function collectFieldKeys(notes: NoteDto[]): string[] {
  const byFolded = new Map<string, string>();
  for (const note of notes) {
    for (const key of Object.keys(note.customFields ?? {})) {
      const folded = key.toLocaleLowerCase('de');
      if (!byFolded.has(folded)) byFolded.set(folded, key);
    }
  }
  return [...byFolded.values()].sort((a, b) => a.localeCompare(b, 'de'));
}

/** The distinct values recorded for one property across the board. */
export function collectFieldValues(notes: NoteDto[], key: string): string[] {
  const folded = key.toLocaleLowerCase('de');
  const values = new Set<string>();
  for (const note of notes) {
    for (const [k, v] of Object.entries(note.customFields ?? {})) {
      if (k.toLocaleLowerCase('de') === folded) values.add(v);
    }
  }
  return [...values].sort((a, b) => a.localeCompare(b, 'de'));
}

export function filterNotes(notes: NoteDto[], view: BoardViewState, currentUserId: string | undefined): NoteDto[] {
  const q = view.q.trim().toLowerCase();
  const fieldKey = view.fieldKey?.toLocaleLowerCase('de');
  const fieldValue = view.fieldValue?.toLocaleLowerCase('de');
  return notes.filter((n) => {
    if (!view.done && n.status === 'DONE') return false;
    if (view.mine && n.assignee?.id !== currentUserId) return false;
    if (view.priority.length && !view.priority.includes(n.priority)) return false;
    if (fieldKey) {
      const match = Object.entries(n.customFields ?? {}).some(
        ([k, v]) =>
          k.toLocaleLowerCase('de') === fieldKey &&
          (!fieldValue || v.toLocaleLowerCase('de') === fieldValue),
      );
      if (!match) return false;
    }
    if (q) {
      const fields = Object.entries(n.customFields ?? {})
        .map(([k, v]) => `${k} ${v}`)
        .join(' ');
      const haystack = `${n.title} ${fields} ${n.tags.join(' ')}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

export function subtaskCountLabel(summary: { done: number; total: number }): string {
  return summary.total ? `${summary.done}/${summary.total}` : '';
}

export function initialsOf(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function displayName(user: { email: string; displayName: string | null } | null | undefined): string {
  if (!user) return '';
  return user.displayName ?? user.email;
}
