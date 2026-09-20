import { DEFAULT_LANGUAGE, languageValues, type Language } from '@wally/shared';

/**
 * The language to seed a BRAND-NEW profile with, taken from the browser's Accept-Language.
 *
 * Called from exactly one place: provisionUser's new-identity branch. Once a profile exists
 * its stored `language` is the only answer, so this stays a plain function rather than a
 * request decorator — a decorator would advertise the header as ambient request state that
 * anything may read, which is precisely the wrong signal. As a free function, "consulted only
 * at provisioning" is a property you can verify with grep.
 *
 * Parsed loosely on purpose. 'de', 'de-DE' and 'en-US,en;q=0.9,de;q=0.8' all resolve; q
 * values are honoured in descending order (Array#sort is stable, so equal-q tags keep their
 * header order, which is what makes 'de,en' resolve to de); q=0 means "not acceptable" and is
 * dropped; '*' and unknown tags are skipped; anything left over lands on DEFAULT_LANGUAGE.
 */
export function languageFromAcceptLanguage(header: string | undefined): Language {
  if (!header) return DEFAULT_LANGUAGE;

  const candidates = header
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const quality = q ? Number.parseFloat(q.slice(2)) : 1;
      return { tag: tag.trim().toLowerCase(), quality: Number.isFinite(quality) ? quality : 0 };
    })
    .filter((candidate) => candidate.tag !== '' && candidate.quality > 0)
    .sort((a, b) => b.quality - a.quality);

  for (const { tag } of candidates) {
    // Primary subtag only: de-AT, de-CH and de-DE are all just German as far as we care.
    const primary = tag.split('-')[0];
    const match = languageValues.find((value) => value === primary);
    if (match) return match;
  }
  return DEFAULT_LANGUAGE;
}
