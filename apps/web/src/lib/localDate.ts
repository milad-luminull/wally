/**
 * A date in the browser's calendar as YYYY-MM-DD, as the API expects it; today when no date
 * is given. Never `toISOString()`, which is UTC and a day off around local midnight.
 */
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
