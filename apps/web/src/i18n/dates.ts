/**
 * Parses a `YYYY-MM-DD` calendar date into a Date at LOCAL midnight.
 *
 * `new Date('2026-09-20')` is parsed as UTC midnight, which is the previous day everywhere
 * west of Greenwich — so a due date would render one day early for those users. Due dates are
 * calendar dates, not instants. This mirrors the `${iso}T00:00:00` trick dayDiff already
 * relies on.
 *
 * Timestamps that carry a zone (history events) need none of this and must not use it.
 */
export function parseIsoDate(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}
