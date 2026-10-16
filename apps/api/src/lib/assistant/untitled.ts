import type { Language } from '@wally/shared';

/**
 * The label an untitled note goes by at the assistant boundary, matching the board's own
 * `common.untitled`. Presentation only: the stored title stays as it is.
 */
const UNTITLED: Record<Language, string> = { de: 'Ohne Titel', en: 'Untitled' };

export function untitledLabel(language: Language): string {
  return UNTITLED[language];
}

/** The title as the model and the chips see it: the untitled label when it is blank. */
export function displayTitle(title: string, language: Language): string {
  return title.trim() === '' ? untitledLabel(language) : title;
}
