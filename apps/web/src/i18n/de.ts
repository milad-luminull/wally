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
  account: {
    menuAria: 'Konto',
    signOut: 'Abmelden',
    language: {
      label: 'Sprache',
      saving: 'Wird gespeichert…',
      saveFailed: 'Sprache konnte nicht gespeichert werden.',
    },
  },
  validation: {
    email: {
      required: 'E-Mail ist erforderlich',
      // One entry, replacing the same literal spelled out in three separate files.
      invalid: 'Ungültige E-Mail-Adresse',
    },
    password: {
      required: 'Passwort ist erforderlich',
      tooShort: 'Mindestens 8 Zeichen',
      confirmRequired: 'Bitte Passwort bestätigen',
      mismatch: 'Passwörter stimmen nicht überein',
    },
  },
  auth: {
    emailLabel: 'E-Mail',
    passwordLabel: 'Passwort',
    passwordConfirmLabel: 'Passwort bestätigen',
    google: 'Mit Google anmelden',
    googlePending: 'Verbinde…',
    signIn: {
      submit: 'Anmelden',
      pending: 'Anmelden…',
      noAccount: 'Noch kein Konto?',
      toSignUp: 'Registrieren',
    },
    signUp: {
      submit: 'Registrieren',
      pending: 'Registrieren…',
      haveAccount: 'Schon ein Konto?',
      toSignIn: 'Anmelden',
    },
    verify: {
      title: 'Bestätige deine E-Mail-Adresse',
      // <strong> travels WITH the words: in English the address lands in a different clause,
      // so the markup cannot be hard-coded around a bare interpolation.
      sentTo: 'Wir haben dir eine E-Mail an <strong>{{email}}</strong> geschickt. Erst danach können wir dich zu einer Wand hinzufügen, zu der du eingeladen wurdest.',
      resend: 'E-Mail erneut senden',
      resending: 'Sende…',
      resendIn: 'Erneut senden in {{seconds}}s',
      confirm: 'Ich habe bestätigt',
      confirming: 'Prüfe…',
      unlocked: 'E-Mail bestätigt. Du hast jetzt Zugriff auf „{{name}}“.',
      openBoard: 'Wand öffnen',
      sent: 'E-Mail gesendet. Schau auch im Spam-Ordner nach.',
      notYet: 'Noch nicht bestätigt. Klicke zuerst den Link in der E-Mail.',
      tooMany: 'Zu viele Versuche. Bitte warte einen Moment.',
      sendFailed: 'Die E-Mail konnte nicht gesendet werden. Bitte erneut versuchen.',
      confirmFailed: 'Das hat nicht geklappt. Bitte erneut versuchen.',
    },
    errors: {
      invalidCredential: 'E-Mail oder Passwort ist falsch.',
      tooManyRequests: 'Zu viele Versuche. Bitte später erneut versuchen.',
      popupClosed: 'Anmeldung abgebrochen.',
      signInFailed: 'Anmeldung fehlgeschlagen. Bitte erneut versuchen.',
      emailInUse: 'Für diese E-Mail-Adresse besteht bereits ein Konto.',
      weakPassword: 'Das Passwort ist zu schwach.',
      signUpFailed: 'Registrierung fehlgeschlagen. Bitte erneut versuchen.',
    },
  },
  board: {
    switcherHeading: 'Wände',
    switcherAria: 'Wand wechseln',
    priorityPrefix: 'Priorität: {{label}}',
    /** dnd-kit live-region announcements — the only feedback a screen-reader user gets
     * while dragging, so they are first-class copy, not debug text. */
    dnd: {
      picked: '{{note}} wird verschoben.',
      overNothing: '{{note}} ist über keinem Ziel.',
      overZone: '{{note}} ist über einem Ablagebereich.',
      notMoved: '{{note}} wurde nicht verschoben.',
      moved: '{{note}} wurde verschoben.',
      cancelled: 'Verschieben von {{note}} abgebrochen.',
      untitled: 'Notiz ohne Titel',
    },
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
    panelAria: 'Notizdetails',
    titlePlaceholder: 'Was ist zu tun?',
    titleAria: 'Titel',
    priorityLabel: 'Priorität',
    dueLabel: 'Fällig',
    assigneeLabel: 'Zuständig',
    noAssignee: 'Niemand',
    doneStatus: 'Erledigt',
    reopen: 'Wieder offen',
    complete: 'Erledigt',
    zone: {
      row: 'Zeile',
      column: 'Spalte',
    },
    delete: {
      title: 'Notiz löschen?',
      body: '„{{title}}“ wird endgültig gelöscht. Das kann nicht rückgängig gemacht werden.',
    },
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
  routes: {
    login: {
      title: 'Willkommen zurück',
      subtitle: 'Melde dich an, um deine Wand zu sehen.',
    },
    signup: {
      title: 'Konto erstellen',
      subtitle: 'Lege dein persönliches Whiteboard an.',
    },
    notFound: {
      title: 'Diese Seite gibt es nicht',
      body: 'Der Link ist vermutlich veraltet, oder die Wand wurde inzwischen gelöscht.',
      action: 'Zurück zur Wand',
    },
    root: {
      loadFailed: 'Deine Wand konnte nicht geladen werden.',
      noBoardTitle: 'Keine Wand gefunden.',
      noBoardBody: 'Bitte wende dich an den Support.',
    },
    redeem: {
      gone: {
        title: 'Dieser Link funktioniert nicht mehr',
        subtitle: 'Er wurde zurückgezogen oder durch einen neuen ersetzt.',
        body: 'Bitte die Person, die dir den Link geschickt hat, um einen neuen.',
      },
      failed: {
        title: 'Das hat nicht geklappt',
        subtitle: 'Der Link konnte nicht eingelöst werden.',
        body: 'Bitte versuche es noch einmal.',
      },
      pending: {
        title: 'Einen Moment',
        subtitle: 'Wir fügen dich zur Wand hinzu.',
      },
      toBoard: 'Zu deiner Wand',
    },
    board: {
      loadFailed: 'Die Wand konnte nicht geladen werden.',
    },
  },
  share: {
    trigger: 'Teilen',
    title: 'Wand teilen',
    copy: 'Kopieren',
    copied: 'Kopiert',
    linkRoleAria: 'Rolle für den Link',
    linkHint: {
      EDIT: 'Jeder mit dem Link kann Notizen anlegen und verschieben.',
      VIEW: 'Jeder mit dem Link kann die Wand ansehen.',
    },
    ownerOnly: 'Nur der Eigentümer kann Freigaben verwalten.',
    members: {
      pending: 'Ausstehend',
      roleAria: 'Rolle von {{name}}',
      remove: '{{name}} entfernen',
    },
    invite: {
      placeholder: 'name@finlex.de',
      aria: 'E-Mail-Adresse einladen',
      submit: 'Einladen',
      pending: 'Lädt ein…',
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
