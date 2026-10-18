/** An IANA zone the runtime knows; anything else would fail later, when the prompt is built. */
export function isTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}
