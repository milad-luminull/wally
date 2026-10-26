import type { NoteHorizon } from '../enums.js';

/**
 * The Sunday that ends the week `today` is in, as a YYYY-MM-DD string. A calendar date's
 * weekday is the same in every zone, so the day is read in UTC.
 */
export function endOfWeek(today: string): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + ((7 - date.getUTCDay()) % 7));
  return date.toISOString().slice(0, 10);
}

/**
 * Where a dated note belongs on the horizon wall (0005-wallybot-inline.md §3.5, plan R3): due
 * today or earlier is Today, due by the Sunday of this week is This week, anything after
 * is Later. Both strings are YYYY-MM-DD, so the string order is the calendar order.
 */
export function horizonForDueDate(dueDate: string, today: string): NoteHorizon {
  if (dueDate <= today) return 'HEUTE';
  if (dueDate <= endOfWeek(today)) return 'DIESE_WOCHE';
  return 'SPAETER';
}
