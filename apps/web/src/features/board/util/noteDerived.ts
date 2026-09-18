import {
  HORIZON_LABELS,
  PRIORITY_LABELS,
  notePriorityValues,
  type NoteColour,
  type NoteDto,
  type NoteHorizon,
  type NotePriority,
} from '@wally/shared';
import type { BoardAxis, BoardViewState } from '../hooks/useBoardViewState';

export type DueTone = 'success' | 'danger' | 'warning' | 'neutral';

export interface DueInfo {
  label: string;
  tone: DueTone;
  weight: 400 | 500 | 600;
}

function formatDate(iso: string): string {
  const [, month, day] = iso.split('-');
  return `${day}.${month}.`;
}

function dayDiff(iso: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${iso}T00:00:00`);
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

/** Mirrors the mockup's urgency ladder, but expressed as design-system status tones
 * (see globals.css) instead of raw hex, so it stays theme-able and consistent with the
 * priority-dot recolouring the plan calls for. */
export function dueInfo(note: Pick<NoteDto, 'status' | 'dueDate'>): DueInfo {
  if (note.status === 'DONE') return { label: 'Erledigt', tone: 'success', weight: 500 };
  if (!note.dueDate) return { label: 'Ohne Datum', tone: 'neutral', weight: 400 };
  const diff = dayDiff(note.dueDate);
  if (diff < 0) return { label: `Überfällig ${formatDate(note.dueDate)}`, tone: 'danger', weight: 600 };
  if (diff === 0) return { label: 'Heute', tone: 'warning', weight: 600 };
  if (diff === 1) return { label: 'Morgen', tone: 'warning', weight: 500 };
  return { label: formatDate(note.dueDate), tone: 'neutral', weight: 400 };
}

export const dueToneClass: Record<DueTone, string> = {
  success: 'text-status-success',
  danger: 'text-status-danger',
  warning: 'text-[color:var(--status-warning)]',
  neutral: 'text-fg-3',
};

export const priorityToneClass: Record<NotePriority, string> = {
  HOCH: 'bg-[color:var(--status-danger-bold)]',
  MITTEL: 'bg-[color:var(--status-warning-bold)]',
  NIEDRIG: 'bg-[color:var(--status-neutral-bold)]',
};

/** 5 swatches only — Apricot intentionally excluded, see packages/shared's noteColourValues
 * comment and the plan's reconciled decision (apricot stays functional-only). */
export const noteColourBorderClass: Record<NoteColour, string> = {
  WEISS: 'border-l-border',
  EIS: 'border-l-[color:var(--note-eis)]',
  SAND: 'border-l-[color:var(--note-sand)]',
  MINZE: 'border-l-[color:var(--note-minze)]',
  HIMMEL: 'border-l-[color:var(--note-himmel)]',
};

export const noteColourSwatchClass: Record<NoteColour, string> = {
  WEISS: 'bg-white',
  EIS: 'bg-[color:var(--note-eis)]',
  SAND: 'bg-[color:var(--note-sand)]',
  MINZE: 'bg-[color:var(--note-minze)]',
  HIMMEL: 'bg-[color:var(--note-himmel)]',
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
export function groupByAxis(notes: NoteDto[], axis: BoardAxis): NoteGroup<string>[] {
  if (axis === 'free') {
    return [{ key: 'ALLE', label: 'Alle Notizen', notes: sortNotes(notes) }];
  }
  if (axis === 'priority') {
    return PRIORITY_ORDER.map((key) => ({
      key,
      label: PRIORITY_LABELS[key],
      notes: sortNotes(notes.filter((n) => n.priority === key)),
    }));
  }
  return HORIZON_ORDER.map((key) => ({
    key,
    label: HORIZON_LABELS[key],
    notes: sortNotes(notes.filter((n) => n.horizon === key)),
  }));
}

export function filterNotes(notes: NoteDto[], view: BoardViewState, currentUserId: string | undefined): NoteDto[] {
  const q = view.q.trim().toLowerCase();
  return notes.filter((n) => {
    if (!view.done && n.status === 'DONE') return false;
    if (view.mine && n.assignee?.id !== currentUserId) return false;
    if (view.priority.length && !view.priority.includes(n.priority)) return false;
    if (q) {
      const haystack = `${n.title} ${n.referenceLabel ?? ''} ${n.tags.join(' ')}`.toLowerCase();
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
