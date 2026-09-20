/**
 * German copy. This catalogue is the KEY AUTHORITY: `CustomTypeOptions` derives the `t()` key
 * union from it, and resources.test.ts holds the English catalogue to exactly these keys.
 *
 * Keys are English and name the string's ROLE (.label, .aria, .body, .action), never its
 * content, so re-wording copy never means renaming a key.
 */
export const de = {
  app: {
    title: 'Wally — Meine Wand',
  },
  common: {
    close: 'Schließen',
    cancel: 'Abbrechen',
    delete: 'Löschen',
    retry: 'Erneut versuchen',
    loading: 'Lädt…',
    untitled: 'Ohne Titel',
    or: 'oder',
    /** Day and month only — the form used on note cards and in the history trail. */
    shortDate: '{{date, datetime(day: 2-digit; month: 2-digit)}}',
  },
} as const;
