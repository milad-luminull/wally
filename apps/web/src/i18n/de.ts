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
    topBar: {
      axis: {
        ariaLabel: 'Organisation',
        horizon: { label: 'Horizont', hint: 'Nach Zeitraum ordnen' },
        priority: { label: 'Priorität', hint: 'Nach Dringlichkeit ordnen' },
        free: { label: 'Frei', hint: 'Notizen frei auf der Wand platzieren' },
      },
      view: {
        ariaLabel: 'Ansicht',
        wand: 'Wand',
        list: 'Liste',
      },
      boardNameAria: 'Name der Wand',
      renameTitle: 'Name bearbeiten',
      open_one: '{{count}} offen',
      open_other: '{{count}} offen',
      overdue_one: '{{count}} überfällig',
      overdue_other: '{{count}} überfällig',
      membersAria_one: '{{count}} Mitglied',
      membersAria_other: '{{count}} Mitglieder',
      // Quoted verbatim by board.empty.board.canEdit — keep the two in step.
      newNote: 'Neue Notiz',
    },
    filter: {
      title: 'Filter',
      searchPlaceholder: 'Suchen',
      searchAria: 'Notizen durchsuchen',
      clearSearch: 'Suche zurücksetzen',
      priorityHeading: 'Priorität',
      priorityAria: 'Nach Priorität {{label}} filtern',
      fieldHeading: 'Eigenschaft',
      fieldAria: 'Eigenschaft',
      fieldPlaceholder: 'Eigenschaft',
      anyField: 'Alle Eigenschaften',
      valueAria: 'Wert',
      anyValue: 'Alle Werte',
      showHeading: 'Anzeigen',
      mine: 'Nur meine',
      done: 'Erledigte',
      reset: 'Zurücksetzen',
      resetLong: 'Filter zurücksetzen',
    },
    empty: {
      board: {
        title: 'Deine Wand ist noch leer',
        // Quotes the top bar's own button label — keep in step with board.topBar.newNote.
        canEdit: 'Lege mit „Neue Notiz“ oben rechts deine erste Notiz an.',
        readOnly: 'Sobald jemand eine Notiz anlegt, erscheint sie hier.',
      },
      filtered: {
        title: 'Keine Notiz passt zum Filter',
        body: 'Passe Suche oder Filter an, um wieder Notizen zu sehen.',
      },
      free: {
        title: 'Freie Wand',
        canEdit: 'Doppelklicke irgendwo auf die Wand, um eine Notiz genau dort anzulegen.',
        readOnly: 'Auf dieser Wand liegt noch nichts.',
      },
    },
    hint: {
      freeMove: 'Notizen frei verschieben geht am Rechner (ab 1080px Breite).',
      dismiss: 'Hinweis ausblenden',
    },
    zone: {
      aria_one: '{{label}}, {{count}} Notiz',
      aria_other: '{{label}}, {{count}} Notizen',
      // Deliberately NOT "Neue Notiz …": that phrase is the top bar's add button, and the
      // suites match accessible names by substring. The English must keep them distinct too.
      addNote: 'Notiz in „{{label}}“ anlegen',
      empty: 'Leer',
      emptyHint: 'Notiz hierher ziehen oder doppelklicken',
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
  note: {
    fields: {
      label: 'Eigenschaften',
      keyPlaceholder: 'Feld',
      keyAria: 'Feldname',
      valuePlaceholder: 'Wert',
      valueAria: 'Feldwert',
      remove: '{{key}} entfernen',
    },
    history: {
      label: 'Verlauf',
      created: 'Angelegt',
      moved: 'Verschoben',
      someone: 'Jemand',
      // Accusative singular: "1 weitere anzeigen" is ungrammatical, which is precisely the
      // bug a `${n} weitere` template can never express.
      showMore_one: '{{count}} weiteren anzeigen',
      showMore_other: '{{count}} weitere anzeigen',
    },
    subtasks: {
      label: 'Unteraufgaben',
      /** A ratio, not a plural — no count suffix. */
      progress: '{{done}} von {{total}}',
      add: 'Unteraufgabe hinzufügen',
      markDone: '{{text}} als erledigt markieren',
      markOpen: '{{text}} als offen markieren',
      remove: '{{text}} entfernen',
    },
    tags: {
      label: 'Schlagworte',
      add: 'Schlagwort hinzufügen',
      addPlaceholder: 'Hinzufügen',
      remove: '{{tag}} entfernen',
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
