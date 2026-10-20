/**
 * A reset time as the person reads it, in their language: with the hour for a daily limit,
 * the date alone for a monthly one. Null for a time that does not parse.
 */
export function formatWhen(iso: string, locale: string, withTime: boolean): string | null {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  return new Intl.DateTimeFormat(
    locale,
    withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' },
  ).format(at);
}
