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
  board: {
    switcher: {
      ownRole: 'Deine Wand',
    },
    group: {
      all: 'Alle Notizen',
    },
    due: {
      done: 'Erledigt',
      none: 'Ohne Datum',
      today: 'Heute',
      tomorrow: 'Morgen',
      overdue: 'Überfällig {{date, datetime(day: 2-digit; month: 2-digit)}}',
    },
  },
  enums: {
    /**
     * Leaves are the raw persisted value, not a slug — Firestore stores these exact strings,
     * so keeping them visible here is what ties a label to the value it renders, and what
     * makes the `satisfies Record<Enum, string>` check in enumLabels.ts meaningful.
     */
    priority: {
      HOCH: 'Hoch',
      MITTEL: 'Mittel',
      NIEDRIG: 'Niedrig',
    },
    horizon: {
      HEUTE: 'Heute',
      DIESE_WOCHE: 'Diese Woche',
      SPAETER: 'Später',
    },
    colour: {
      WEISS: 'Ohne',
      EIS: 'Eisblau',
      SAND: 'Sand',
      MINZE: 'Minze',
      HIMMEL: 'Himmel',
      NEBEL: 'Nebel',
      BUTTER: 'Butter',
      LEHM: 'Lehm',
      ROSE: 'Rosé',
      MALVE: 'Malve',
      FLIEDER: 'Flieder',
      SEEGRUEN: 'Seegrün',
      SALBEI: 'Salbei',
      OLIV: 'Oliv',
    },
    whiteboardRole: {
      VIEW: 'Ansehen',
      EDIT: 'Bearbeiten',
    },
    effectiveRole: {
      OWNER: 'Eigentümer',
      EDIT: 'Bearbeiten',
      VIEW: 'Ansehen',
    },
  },
} as const;
