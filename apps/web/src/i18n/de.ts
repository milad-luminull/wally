/**
 * German copy. This catalogue is the KEY AUTHORITY: `CustomTypeOptions` derives the `t()` key
 * union from it, and resources.test.ts holds the English catalogue to exactly these keys.
 *
 * Keys are English and name the string's ROLE (.label, .aria, .body, .action), never its
 * content, so re-wording copy never means renaming a key.
 */
export const de = {
  accountData: {
    exportTitle: 'Deine Daten',
    exportHint: 'Lade alles, was du in Wally siehst, als eine JSON-Datei herunter.',
    download: 'Meine Daten herunterladen',
    exportFailed: 'Deine Daten konnten nicht heruntergeladen werden. Versuch es noch einmal.',
    deleteTitle: 'Konto löschen',
    deleteHint:
      'Löscht dein Konto und alles, was du erstellt hast, sofort. Das lässt sich nicht rückgängig machen.',
    deleteBoards: 'Diese Wände werden für alle gelöscht:',
    deleteNoBoards: 'Du besitzt keine Wände.',
    deleteSharedWith: 'geteilt mit {{names}}',
    deleteNotes:
      'Deine Notizen auf fremden Wänden werden ebenfalls gelöscht. Karten, die dir nur zugewiesen sind, bleiben.',
    deleteTypeEmail: 'Gib {{email}} ein, um zu bestätigen',
    deleteConfirm: 'Mein Konto löschen',
    deleteFailed: 'Dein Konto konnte nicht gelöscht werden. Versuch es noch einmal.',
    deleteLoading: 'Deine Wände werden geladen …',
    deleteListFailed:
      'Deine Wände konnten nicht geladen werden. Schließ das Fenster und versuch es noch einmal.',
    deleted: 'Dein Konto ist gelöscht.',
  },
  legal: {
    privacy: 'Datenschutzerklärung',
    terms: 'Nutzungsbedingungen',
    agreement:
      'Mit dem Fortfahren stimmst du den <terms>Nutzungsbedingungen</terms> zu und nimmst die <privacy>Datenschutzerklärung</privacy> zur Kenntnis.',
  },
  settings: {
    title: 'Einstellungen',
    back: 'Zurück',
    backToList: 'Zurück zu den Einstellungen',
    sections: {
      appearance: {
        label: 'Darstellung',
        description: 'Farben, hell oder dunkel und der Hintergrund der Wand.',
      },
      language: {
        label: 'Sprache',
        description: 'Die Sprache, die Wally verwendet.',
      },
      wallybot: {
        label: 'Wallybot',
        description: 'Ob Vorschläge sofort gelten oder auf dich warten.',
      },
      connections: {
        label: 'Verbundene Apps',
        description: 'Lass ChatGPT, Claude oder andere KI-Apps deine Wände nutzen.',
      },
      account: {
        label: 'Konto und Daten',
        description: 'Lade deine Daten herunter oder lösche dein Konto.',
      },
    },
    appearance: {
      mode: 'Modus',
      modeHint: 'Bei System folgt Wally deinem Gerät.',
    },
    wallybot: {
      hint: 'Vorschläge warten auf Enter, statt automatisch zu gelten.',
    },
    account: {
      accountLabel: 'Dein Konto',
    },
    copy: '{{label}} kopieren',
    copied: 'Kopiert',
  },
  connections: {
    description:
      'Eine verbundene App kann nur, was du in Wally kannst, und deine privaten Notizen bleiben vor anderen geschützt.',
    loading: 'Verbindungen werden geladen…',
    loadError: 'Verbindungen konnten nicht geladen werden.',
    retry: 'Erneut versuchen',
    disabled: 'App-Verbindungen sind derzeit nicht verfügbar.',
    saveError: 'Die Änderung konnte nicht gespeichert werden. Bitte versuche es erneut.',
    saving: 'Wird gespeichert…',
    saved:
      'Verbindung aktualisiert. Kehre nach dem Wiederverbinden zu ChatGPT, Claude oder deinem gewählten Anbieter zurück und melde dich erneut bei Wally an.',
    none: 'Nicht verbunden',
    revoked: 'Getrennt',
    reconnectHint:
      'Wähle Erneut verbinden. Kehre dann zu ChatGPT, Claude oder deinem gewählten Anbieter zurück und melde dich erneut bei Wally an.',
    issue: 'Verbindungsproblem',
    connected: 'Verbunden',
    revokeNamed: '{{name}} trennen',
    revoke: 'Trennen',
    reconnectNamed: '{{name}} erneut verbinden',
    reconnect: 'Erneut verbinden',
    setupTitle: 'Wally mit deinem KI-Anbieter verbinden',
    setupSteps: 'Schritte zum Verbinden',
    setupOpen:
      'Öffne in ChatGPT, Claude oder deinem bevorzugten KI-Anbieter die Einstellungen und suche nach Apps oder Konnektoren. Füge eine eigene MCP-Verbindung namens Wally hinzu.',
    setupUrl:
      'Füge die Verbindungs-URL unten als Server-URL ein und wähle OAuth als Authentifizierung.',
    setupLocalUrl:
      'Wähle in ChatGPT den eingerichteten Wally-Testtunnel. Für einen lokalen MCP-Client nutze die URL unten. Wähle OAuth als Authentifizierung.',
    setupClientId:
      'Fragt er nach einer OAuth-Client-ID, zum Beispiel unter den erweiterten OAuth-Einstellungen, füge die Client-ID unten ein. Lass das Client-Secret leer.',
    setupSignIn:
      'Melde dich mit deinem Wally-Konto an und bestätige den Zugriff. Wähle dann Wally in einem Chat und probiere „Zeig meine Boards“.',
    localSetupHint:
      'Dies ist ein lokaler Testserver. ChatGPT kann localhost nicht direkt erreichen und benötigt einen funktionierenden Tunnel.',
    endpoint: 'Verbindungs-URL',
    clientId: 'OAuth-Client-ID',
  },
  welcome: {
    open: 'Wally öffnen',
    brand: 'Wally',
    byline: 'by Luminull',
    navigation: 'Hauptnavigation',
    login: 'Anmelden',
    signup: 'Registrieren',
    start: 'Deine Wand starten',
  },
  landing: {
    nav: {
      how: 'So funktioniert’s',
      voice: 'Sprache',
      views: 'Ansichten',
      faq: 'FAQ',
    },
    headline: 'Ab an die Wand.',
    headlineNext: 'Wally macht',
    headlineHighlight: 'den Rest.',
    description:
      'Aufgaben, Besprechungsnotizen, Termine, Ideen, Sprachnotizen. Sammle alles an einem Ort. Wally sortiert, plant und bringt deinen Arbeitstag in Ordnung. Du behältst bei jeder Änderung das letzte Wort.',
    floating: [
      'beim Kunden nachfragen',
      'q3-bericht fr',
      'Stand-up-Notizen',
      'Idee: Onboarding verbessern',
    ],
    howTitle: 'Ein Ort für alles. Wally übernimmt den Rest.',
    steps: [
      {
        title: 'Wirf alles rein',
        body: 'Tippe es, sag es oder leite es weiter. Aufgaben, Besprechungsnotizen und Termine landen auf derselben Wand.',
      },
      {
        title: 'Wally sortiert es',
        body: 'Wally erkennt, worum es geht, wann es fällig ist, wer beteiligt ist und welche Schritte dazugehören. Du behältst, was dir hilft.',
      },
      {
        title: 'Dein Tag, geordnet',
        body: 'Alles landet am richtigen Tag, neben deinen Besprechungen. Wally plant deinen Tag mit einem Klick.',
      },
    ],
    captureKinds: ['Aufgabe', 'Besprechung', 'Idee', 'Sprachnotiz'],
    captureExample: 'maya fr nachfragen',
    voiceTitle: 'Sag es.',
    voiceTitleNext: 'Wally schreibt mit.',
    voiceBody:
      'Sprich, wie du denkst. Eine Rückfrage, eine Prüfung und eine Besprechung in einem Atemzug werden zu drei Karten am richtigen Ort. Oder sag einfach „Plane meinen Tag“.',
    voiceListening: 'Hört zu',
    voiceTranscript:
      'Frag Maya am Freitag nach dem Angebot, erinnere mich morgen an die Vertragsprüfung und vereinbare eine Besprechung mit Leo am Donnerstag um zwei',
    voiceCards: [
      {
        title: 'Bei Maya zum Angebot nachfragen',
        meta: 'Aufgabe · Fr 23',
      },
      {
        title: 'Vertrag prüfen',
        meta: 'Aufgabe · Morgen',
      },
      {
        title: 'Besprechung mit Leo',
        meta: 'Besprechung · Do 14 Uhr',
      },
    ],
    viewsLabel: 'Eine Wand, jede Ansicht',
    viewsTitle: 'Sieh dieselben Notizen so, wie du sie heute brauchst.',
    views: {
      week: {
        label: 'Diese Woche',
        description: 'Heute, morgen, diese Woche und später – nebeneinander.',
      },
      priority: {
        label: 'Priorität',
        description: 'Hoch, mittel und niedrig. Was zuerst zählt, auf einen Blick.',
      },
      whiteboard: {
        label: 'Whiteboard',
        description: 'Ziehe Notizen an beliebige Stellen und gruppiere sie in Zonen.',
      },
      today: {
        label: 'Heute',
        description: 'Nur heute, mit einem Kalender daneben.',
      },
      focus: {
        label: 'Fokus',
        description: 'Eine Notiz, ihr nächster Schritt und Wallybot als Hilfe.',
      },
    },
    notes: [
      {
        title: 'Angebot an Maya senden',
        meta: 'Heute · Hoch',
      },
      {
        title: 'Team-Sync',
        meta: 'Heute · 11 Uhr',
      },
      {
        title: 'Rechnungen freigeben',
        meta: 'Heute',
      },
      {
        title: 'Vertragsentwurf prüfen',
        meta: 'Morgen',
      },
      {
        title: 'Q3-Budget mit Leo',
        meta: 'Do · 14 Uhr',
      },
      {
        title: 'Projektbrief fertigstellen',
        meta: 'Fr 23 · Hoch',
      },
      {
        title: 'Idee: einfacheres Onboarding',
        meta: 'Später',
      },
      {
        title: 'Zahnarzttermin buchen',
        meta: 'Später',
      },
    ],
    focusStep: 'Schritt 1 von 3 · Noch einmal durchlesen',
    controlLabel: 'Du behältst die Kontrolle',
    controlTitle: 'KI schlägt vor. Du entscheidest.',
    control: [
      {
        title: 'Erst vorschlagen, dann anwenden',
        body: 'Jede Änderung erscheint zuerst auf der Karte. Nichts wird geschrieben, bevor du es übernimmst.',
      },
      {
        title: 'Schweigen heißt ja',
        body: 'Gerade beschäftigt? Tu nichts und der Vorschlag speichert sich nach ein paar Sekunden von selbst.',
      },
      {
        title: 'Immer rückgängig zu machen',
        body: 'Mach jede Änderung rückgängig, auch nach dem Speichern. Dein ursprünglicher Text ist immer nur einen Klick entfernt.',
      },
    ],
    joinTitle: 'Alles an einem Ort.',
    joinBody: 'Starte deine Wand und gib allem, was dir durch den Kopf geht, einen Platz.',
    joinSignedIn: 'Deine Wand ist bereit. Mach dort weiter, wo du aufgehört hast.',
    joinNote: 'Privat und beruflich · Ein Ort für alles',
    joinNotes: ['alles an einem Ort', 'Wally kümmert sich ✓'],
    questions: 'Fragen',
    faqs: [
      {
        question: 'Was kann ich in Wally sammeln?',
        answer:
          'Alles, was du sonst im Kopf behältst: Aufgaben, Besprechungsnotizen, Termine, Ideen und Sprachnotizen. Wally erkennt, worum es geht, und bringt alles an den richtigen Platz.',
      },
      {
        question: 'Ändert die KI meine Notizen ungefragt?',
        answer:
          'Nein. Änderungen erscheinen als Vorschlag auf der Karte. Übernimm sie, lass etwas aus oder mache sie rückgängig. Wenn du nichts tust, werden sie nach ein paar Sekunden gespeichert. Du kannst sie auch danach rückgängig machen.',
      },
      {
        question: 'Ist Wally für die Arbeit oder privat?',
        answer:
          'Wally ist zuerst für deinen Arbeitstag gedacht, hält aber auch gern deine privaten Dinge fest. Nutze getrennte Wände für Arbeit und Privates oder sieh alles zusammen.',
      },
      {
        question: 'Welche Plattformen werden unterstützt?',
        answer:
          'Zuerst das Web, später iOS- und Android-Apps zum schnellen Erfassen unterwegs, auch per Sprache.',
      },
    ],
    copyright: '© {{year}} Luminull',
    skip: 'Zum Inhalt springen',
    demo: {
      label: 'Interaktive Demo',
      note: 'Interaktive Demo · Nur Beispielvorschläge',
      input: 'Probiere eine Notiz',
      placeholder: 'Zum Beispiel „Besprechung mit Leo Do 14 Uhr“',
      add: 'Hinzufügen',
      voice: 'Sprachdemo abspielen',
      pause: 'Animationen pausieren',
      play: 'Animationen abspielen',
      poke: 'Sag Hallo zu Wallybot',
      moods: {
        ready: 'bereit',
        listening: 'hört zu…',
        voice: 'versteht dich…',
        thinking: 'sortiert…',
        review: 'passt das?',
        kept: 'abgelegt ✓',
        hello: 'Hi, ich bin Wallybot',
      },
      idle: 'Hier erscheint deine nächste Karte',
      waiting: 'Wallybot wartet auf ⏎',
      reading: 'Liest deine Notiz…',
      details: 'Erkennt die Details…',
      steps: 'Ergänzt die nächsten Schritte…',
      keep: 'Übernehmen',
      undo: 'Rückgängig',
      review: 'Prüfe dieses Beispiel',
      saving: 'Speichert sich von selbst',
      saved: 'In der Demo abgelegt',
      trays: {
        today: 'Heute',
        week: 'Diese Woche',
        meet: 'Termine',
        ideas: 'Ideen',
      },
      trayCount: '{{name}} Beispielnotizen',
      kind: {
        meeting: 'Besprechung',
        note: 'Notiz',
        todo: 'Aufgabe',
      },
      fields: {
        type: 'Typ',
        due: 'Fällig',
        when: 'Wann',
        with: 'Mit',
        priority: 'Priorität',
        takes: 'Dauer',
        filed: 'Ablage',
      },
      days: {
        today: 'Heute',
        tomorrow: 'Morgen',
        mon: 'Mo 26',
        tue: 'Di 27',
        wed: 'Mi 21',
        thu: 'Do 22',
        fri: 'Fr 23',
        next: 'Nächste Woche',
      },
      high: 'Hoch',
      medium: 'Mittel',
      duration: '{{count}} Min.',
      ideas: 'Ideen',
      someone: 'der Person',
      phrases: [
        'Besprechung mit Leo Do 14 Uhr zum Q3-Budget',
        'Anruf mit Sam am Donnerstag um 10 Uhr zum Launch',
        'Angebot an Maya Fr dringend senden',
        'Idee: Onboarding vereinfachen',
        'Vertragsentwurf morgen prüfen 30m',
        'Vertrag morgen prüfen 30m',
      ],
      subs: {
        meeting: ['Agenda teilen', 'Zahlen vorbereiten', 'Danach Notizen versenden'],
        review: ['Durchlesen', 'Offene Fragen markieren', 'Kommentare senden'],
        idea: ['Erste Gedanken aufschreiben', 'Teilen, sobald es bereit ist'],
        call: ['Details ansehen', '{{who}} anrufen', 'Vereinbarung festhalten'],
        send: ['Noch einmal durchlesen', 'An {{who}} senden', 'Bei Bedarf nachfragen'],
        book: ['Passenden Zeitpunkt finden', 'Buchen', 'In den Kalender eintragen'],
        other: ['Ersten Schritt klären', 'Erledigen', 'Abhaken'],
      },
    },
  },
  appearance: {
    palette: 'Farbpalette',
    menu: 'Darstellung und Sprache',
    palettes: {
      minimal: 'Minimal',
      paper: 'Paper Wall',
      morning: 'Clear Morning',
      highlighter: 'Highlighter',
      aurora: 'Aurora',
      daybreak: 'Daybreak',
      sprout: 'Sprout',
      amber: 'Amber Poster',
      neutral: 'Neutral',
    },
  },

  safety: {
    status: { OPEN: 'Offen', DONE: 'Abgeschlossen', ACTIVE: 'Aktiv', PENDING: 'Eingeladen' },
    missingTarget: 'Dieses Mitglied oder dieser Eintrag ist nicht mehr verfügbar.',
    expired:
      'Das Zeitfenster von sieben Tagen für Wiederholungen ist abgelaufen. Prüfe das Board, bevor du eine neue Aktion startest. Dein Entwurf bleibt hier verfügbar.',
    pending: 'Ungespeicherte Änderungen ({{count}})',
    title: 'Ungespeicherte Änderung prüfen',
    conflict:
      'Dieser Eintrag wurde während der Bearbeitung geändert. Deine Änderung bleibt erhalten. Prüfe den aktuellen Stand, bevor du sie anwendest.',
    failed:
      'Konnte das Speichern nicht bestätigen. Erneut versuchen sendet dieselbe Änderung, nichts wird doppelt angelegt.',
    latest: 'Aktuell gespeicherter Stand',
    proposed: 'Deine Änderung',
    apply: 'Geprüfte Änderung anwenden',
    discard: 'Änderung verwerfen',
    keep: 'Für später behalten',
    unavailable: 'Konnte den aktuellen Stand nicht laden. Deine Änderung bleibt erhalten.',
    reload:
      'Bitte lade Wally neu, um die aktualisierten Schutzfunktionen beim Speichern zu nutzen.',
    empty: 'Leer',
    none: 'Keine',
    yes: 'Ja',
    no: 'Nein',
    actions: {
      update: 'Aktualisieren',
      create: 'Notiz erstellen',
      duplicate: 'Notiz duplizieren',
      delete: 'Notiz löschen',
      move: 'Notiz verschieben',
      assign: 'Notiz zuweisen',
      complete: 'Notiz abschließen',
      reopen: 'Notiz wieder öffnen',
      subtask: 'Teilaufgabe ändern',
      member: 'Mitgliedschaft ändern',
      shareLink: 'Freigabelink ändern',
      deleteBoard: 'Wand löschen',
      leaveBoard: 'Wand verlassen',
    },
    fields: {
      change: 'Änderung',
      assignee: 'Zuständig',
      status: 'Status',
      subtasks: 'Teilaufgaben',
      subtaskSummary: 'Teilaufgaben',
      total: 'Gesamt',
      displayName: 'Name',
      completedAt: 'Abgeschlossen am',
      title: 'Titel',
      description: 'Beschreibung',
      name: 'Name',
      text: 'Text',
      done: 'Abgeschlossen',
      dueDate: 'Fällig am',
      colour: 'Farbe',
      priority: 'Priorität',
      horizon: 'Zeitraum',
      visibility: 'Sichtbarkeit',
      tags: 'Tags',
      customFields: 'Eigenschaften',
      fieldChanges: 'Eigenschaftsänderungen',
      tagChanges: 'Tag-Änderungen',
      role: 'Berechtigung',
      email: 'E-Mail',
      assigneeId: 'Zuständig',
      freeX: 'Horizontale Position',
      freeY: 'Vertikale Position',
      x: 'Horizontale Position',
      y: 'Vertikale Position',
      mode: 'Ansicht',
      set: 'Setzen',
      remove: 'Entfernen',
      add: 'Hinzufügen',
    },
  },

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
    you: 'Du',
    or: 'oder',
    /** Day and month only — the form used on note cards and in the history trail. */
    shortDate: '{{date, datetime(day: 2-digit; month: 2-digit)}}',
  },
  account: {
    menuAria: 'Profil & Einstellungen',
    signOut: 'Abmelden',
    shortcuts: 'Tastenkürzel',
    theme: { label: 'Darstellung', system: 'System', light: 'Hell', dark: 'Dunkel' },
    canvas: { label: 'Hintergrund der freien Wand', dots: 'Punkte', grid: 'Raster', none: 'Leer' },
    language: {
      label: 'Sprache',
      saving: 'Wird gespeichert…',
      saveFailed: 'Konnte die Sprache nicht speichern',
    },
    wallybot: {
      alwaysAsk: 'Immer fragen',
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
    hosted: {
      description:
        'Melde dich sicher mit Google, einem Passkey oder deiner E-Mail auf unserer Anmeldeseite an.',
      passwordReset:
        'Passwort vergessen? Wähle auf der nächsten Seite „Passwort vergessen“, um es zurückzusetzen.',
      migration:
        'Für diese E-Mail-Adresse gibt es schon ein Wally-Konto. Melde dich so an, wie du dich registriert hast, zum Beispiel mit Google.',
      unverified:
        'Bitte bestätige deine E-Mail-Adresse über den Link, den wir dir geschickt haben, und melde dich dann erneut an.',
      unavailable: 'Die Anmeldung konnte nicht abgeschlossen werden. Bitte versuche es erneut.',
      pending: 'Verbindung wird hergestellt…',
      login: 'Weiter zur Anmeldung',
      signup: 'Weiter zur Registrierung',
      switchAccount: 'Anderes Konto verwenden',
      verify:
        'Bestätige deine E-Mail über die Nachricht unseres Anmeldedienstes und prüfe dann erneut.',
    },
    sessionEnded: 'Deine Sitzung ist abgelaufen. Melde dich erneut an, um weiterzumachen.',
    sessionEndedUnsaved_one:
      'Deine Sitzung ist abgelaufen, {{count}} nicht gespeicherte Änderung ging verloren. Melde dich erneut an, um weiterzumachen.',
    sessionEndedUnsaved_other:
      'Deine Sitzung ist abgelaufen, {{count}} nicht gespeicherte Änderungen gingen verloren. Melde dich erneut an, um weiterzumachen.',
    signIn: {
      noAccount: 'Noch kein Konto?',
      toSignUp: 'Registrieren',
    },
    signUp: {
      haveAccount: 'Schon ein Konto?',
      toSignIn: 'Anmelden',
    },
    verify: {
      confirm: 'Ich habe bestätigt',
      confirming: 'Prüfe…',
      unlocked: 'E-Mail bestätigt. Du hast jetzt Zugriff auf „{{name}}“.',
      openBoard: 'Wand öffnen',
      notYet: 'Noch nicht bestätigt. Klicke zuerst den Link in der E-Mail.',
      confirmFailed: 'Konnte das nicht prüfen. Versuch es erneut.',
    },
  },
  errors: {
    crash: {
      title: 'Etwas ist schiefgelaufen',
      hint: 'Lade die Seite neu, um weiterzumachen.',
      reload: 'Neu laden',
    },
    offline: 'Du bist offline. Änderungen werden gespeichert, sobald du wieder online bist.',
    notesFailed: {
      title: 'Konnte die Notizen nicht laden',
      hint: 'Prüfe deine Verbindung und versuch es erneut.',
    },
    noteGone: 'Diese Notiz wurde gelöscht oder wird nicht mehr mit dir geteilt',
    noteFailed: 'Konnte diese Notiz nicht laden',
    saveFailed: 'Konnte die Änderung nicht speichern',
    refused: {
      forbidden: 'Das kannst du hier nicht ändern',
      gone: 'Das wurde inzwischen gelöscht',
      assignee: 'Diese Person ist nicht auf dieser Wand',
      link: 'Diese Notiz lässt sich nicht verknüpfen',
      other: 'Diese Änderung ist nicht erlaubt',
    },
  },
  toast: {
    prefsFailed: 'Konnte deine Einstellungen nicht speichern',
    noteDeleted: '„{{title}}“ gelöscht',
    noteDeletedUntitled: 'Notiz gelöscht',
    noteDuplicated: '„{{title}}“ dupliziert',
    noteDuplicatedUntitled: 'Notiz dupliziert',
    memberRemoved: '{{name}} entfernt',
    undo: 'Rückgängig',
    inviteSent: '{{email}} zu „{{name}}“ eingeladen',
    notePrivate: 'Jetzt privat. Nur du siehst diese Notiz.',
    noteShared: 'Jetzt für alle auf der Wand sichtbar.',
  },
  palette: {
    aria: 'Befehle',
    placeholder: 'Befehl oder Notiz suchen…',
    empty: 'Nichts gefunden.',
    trigger: 'Befehle',
    groups: {
      actions: 'Aktionen',
      notes: 'Notizen',
      view: 'Ansicht',
      boards: 'Wände',
      settings: 'Einstellungen',
    },
    openSettings: 'Einstellungen öffnen',
    focusSearch: 'Notizen filtern',
    duplicateNote: 'Notiz duplizieren',
    share: 'Wand teilen',
    viewWall: 'Zur Wand wechseln',
    viewList: 'Zur Liste wechseln',
    showDone: 'Erledigte einblenden',
    hideDone: 'Erledigte ausblenden',
    onlyMine: 'Nur meine Notizen',
    allNotes: 'Alle Notizen zeigen',
    resetView: 'Ansicht zurücksetzen',
    switchBoard: 'Wechseln zu {{name}}',
    theme: 'Darstellung: {{label}}',
    canvas: 'Freie Wand: {{label}}',
    language: 'Sprache: {{label}}',
  },
  shortcuts: {
    title: 'Tastenkürzel',
    palette: 'Befehle öffnen',
    newNote: 'Neue Notiz',
    search: 'Suche fokussieren',
    toggleView: 'Wand oder Liste',
    groupHorizon: 'Nach Horizont gruppieren',
    groupPriority: 'Nach Priorität gruppieren',
    groupFree: 'Frei anordnen',
    closePanel: 'Notiz schließen',
    duplicateNote: 'Notiz duplizieren',
    undoSuggestion: 'Übernommene Änderung rückgängig',
    /** Shown next to the Alt/Option key: held while dragging a card. */
    copyDrag: 'Beim Ziehen gedrückt: Kopie ablegen',
    help: 'Diese Übersicht',
    then: 'dann',
  },
  board: {
    rail: {
      wall: 'Board',
      views: 'Board-Ansichten',
      whiteboard: 'Whiteboard',
      collapse: 'Seitenleiste einklappen',
      expand: 'Seitenleiste ausklappen',
    },
    rowStatus: { markOpen: 'Als offen markieren', markDone: 'Als erledigt markieren' },
    switcherHeading: 'Boards',
    switcherAria: 'Board wechseln',
    priorityPrefix: 'Priorität: {{label}}',
    /** dnd-kit live-region announcements — the only feedback a screen-reader user gets
     * while dragging, so they are first-class copy, not debug text. */
    dnd: {
      picked: '{{note}} wird verschoben.',
      overNothing: '{{note}} ist über keinem Ziel.',
      overZone: '{{note}} ist über einem Ablagebereich.',
      notMoved: '{{note}} wurde nicht verschoben.',
      moved: '{{note}} wurde verschoben.',
      copied: 'Eine Kopie von {{note}} wurde abgelegt.',
      cancelled: 'Verschieben von {{note}} abgebrochen.',
      untitled: 'Notiz ohne Titel',
    },
    switcher: {
      ownRole: 'Dein Board',
      all: 'Alle Boards',
    },
    topBar: {
      home: 'Zu deinen Boards',
      axis: {
        ariaLabel: 'Gruppierung',
        horizon: { label: 'Diese Woche', hint: 'Nach Zeitraum ordnen' },
        priority: { label: 'Priorität', hint: 'Nach Dringlichkeit ordnen' },
        free: { label: 'Frei', hint: 'Notizen frei auf dem Board platzieren' },
      },
      view: {
        ariaLabel: 'Ansicht',
        wall: 'Board',
        list: 'Liste',
      },
      boardNameAria: 'Board-Name',
      renameTitle: 'Name bearbeiten',
      open_one: '{{count}} offen',
      open_other: '{{count}} offen',
      overdue_one: '{{count}} überfällig',
      overdue_other: '{{count}} überfällig',
      // Quoted verbatim by board.empty.board.canEdit — keep the two in step.
      newNote: 'Neue Notiz',
      newPrivateNote: 'Neue private Notiz',
      display: {
        label: 'Anzeige',
        remembered: 'Wally merkt sich die Ansicht pro Board.',
        reset: 'Zurücksetzen',
      },
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
      done: 'Erledigte ausblenden',
      reset: 'Zurücksetzen',
      resetLong: 'Filter zurücksetzen',
      onlyPrivate: 'Nur private',
      hidePrivate: 'Private ausblenden',
      visibilityAria: 'Private Notizen',
    },
    empty: {
      board: {
        title: 'Deine Wand ist noch leer',
        // Quotes the top bar's own button label — keep in step with board.topBar.newNote.
        canEdit: 'Lege mit „Neue Notiz“ oben rechts deine erste Notiz an.',
        viewer: 'Du kannst diese Wand ansehen. Notizen, die du hier anlegst, sind privat.',
      },
      filtered: {
        title: 'Keine Notiz passt zum Filter',
        body: 'Passe Suche oder Filter an, um wieder Notizen zu sehen.',
      },
      free: {
        title: 'Freie Wand',
        canEdit: 'Doppelklicke irgendwo auf die Wand, um eine Notiz genau dort anzulegen.',
        viewer: 'Doppelklicke auf die Wand für eine private Notiz. Nur du siehst sie.',
      },
    },
    hint: {
      freeMove: 'Notizen frei verschieben geht am Rechner (ab 1080px Breite).',
      dismiss: 'Hinweis ausblenden',
    },
    zone: {
      priorityHints: { HIGH: 'Das zuerst', MEDIUM: 'Wenn Zeit bleibt', LOW: 'Wäre schön' },
      add: 'Notiz hinzufügen',
      aria_one: '{{label}}, {{count}} Notiz',
      aria_other: '{{label}}, {{count}} Notizen',
      // Deliberately NOT "Neue Notiz …": that phrase is the top bar's add button, and the
      // suites match accessible names by substring. The English must keep them distinct too.
      addNote: 'Notiz in „{{label}}“ anlegen',
      empty: 'Leer',
      emptyHint: 'Notiz hierher ziehen oder doppelklicken',
      noMatch: 'Keine Treffer',
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
    open: 'Öffnen',
    makePrivate: 'Privat machen',
    actions: 'Notizaktionen',
    expand: 'Notiz im Vollbild öffnen',
    collapse: 'In Seitenleiste öffnen',
    details: 'Details',
    showActivity: 'Aktivität anzeigen · {{count}}',
    panelAria: 'Notizdetails',
    titlePlaceholder: 'Was ist zu tun?',
    titleAria: 'Titel',
    descriptionPlaceholder: 'Beschreibung hinzufügen…',
    descriptionAria: 'Beschreibung',
    duplicate: 'Duplizieren',
    colourLabel: 'Farbe',
    priorityLabel: 'Priorität',
    dueLabel: 'Fällig',
    assigneeLabel: 'Zuständig',
    private: {
      label: 'Privat',
      hintOff: 'Nur du siehst eine private Notiz.',
      hintOn: 'Nur du siehst diese Notiz.',
      needsEdit: 'Zum Teilen brauchst du Bearbeitungsrechte.',
      assigneeLocked: 'Private Notizen gehören immer dir.',
      badge: 'Private Notiz',
    },
    noAssignee: 'Niemand',
    assignedTo: 'Zuständig: {{name}}',
    assignedToYou: 'Dir zugewiesen',
    /** The current user's own entry in the assignee picker. */
    youSuffix: '{{name}} (du)',
    doneStatus: 'Erledigt',
    zone: {
      column: 'Spalte',
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
      duplicated: 'Als Kopie angelegt',
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
    related: {
      label: 'Verwandte Notizen',
      add: 'Notiz verknüpfen…',
      search: 'Notiz suchen',
      empty: 'Keine passende Notiz',
      remove: 'Verknüpfung zu {{title}} entfernen',
      fromOther: 'Verknüpft von {{title}}',
      linked: 'Verknüpft mit {{title}}',

      count_one: '{{count}} verwandt',
      count_other: '{{count}} verwandt',
    },
  },
  /** The answer card on the wall (RFC-0005-wallybot-inline.md §3.6). No name, no first person. */
  ask: {
    asking: 'Die Wand wird gelesen',
    notesRead: 'Gelesene Notizen',
    partial: 'Nur ein Teil der passenden Notizen wurde gelesen.',
    stopped: {
      TOOL_LIMIT: 'Nach zwölf Lesevorgängen gestoppt. Eine engere Frage hilft.',
      TIMEOUT: 'Keine Antwort innerhalb einer Minute. Eine engere Frage hilft.',
      LENGTH: 'Die Antwort wurde gekürzt.',
    },
    limit: {
      daily: 'Tageslimit erreicht. Ab {{when}} wieder verfügbar.',
      monthly: 'Monatslimit erreicht. Ab {{when}} wieder verfügbar.',
      busy: 'Gerade beschäftigt. Gleich noch einmal versuchen.',
    },
    failed: 'Keine Antwort. Noch einmal versuchen.',
  },
  noteEdit: {
    cardAria: 'Notiz bearbeiten',
    titleAria: 'Titel der Notiz',
    descriptionAria: 'Text der Notiz',
    hint: '↵ speichern · ⇧↵ Text · Esc abbrechen',
    hintCoarse: 'Enter speichert',
  },
  /**
   * The Wally box (docs/superpowers/specs/2026-11-08-wally-box-design.md): one place to write a
   * note or ask. No name for the AI in the first person, no exclamation marks.
   */
  box: {
    aria: 'Schreib eine Notiz oder frag Wally',
    placeholder: 'Schreib eine Notiz oder frag Wally…',
    placeholderNotesOnly: 'Schreib eine Notiz…',
    hintNote: 'Legt eine Notiz an',
    hintAsk: 'Fragt Wally',
    switchHint: '{{hint}}. Wechseln zu: {{other}}',
    pinned: 'Gewechselt zu: {{hint}}',
    pendingAria: 'In Arbeit: {{text}}',
    close: 'Schließen',
    savedAsWritten: 'So gespeichert, wie du es geschrieben hast.',
    truncated: 'Die ersten 10 Notizen sind angelegt. Schick den Rest noch einmal.',
    askFailed: 'Wally konnte gerade nicht antworten. Deine Worte stehen wieder im Feld.',
    duplicate: 'Du hast schon „{{title}}“.',
    openIt: 'Öffnen',
    addAnyway: 'Trotzdem anlegen',
  },
  capture: {
    chips: {
      due: 'Fällig {{date}}',
      assignee: 'Zuständig: {{name}}',
      priorityHigh: 'Priorität hoch',
      priorityLow: 'Priorität niedrig',
      dropNamed: 'Vorschlag entfernen: {{label}}',
    },
  },
  /** The dashed card after Enter (RFC-0005-wallybot-inline.md §3.3). No name, no first person. */
  suggest: {
    dotAria: 'Vorgeschlagene Änderungen, werden gleich übernommen',
    dotAriaWaiting: 'Vorgeschlagene Änderungen, warten auf Enter',
    dotAriaAsking: 'Wird ausgefüllt',
    undo: 'Rückgängig',
    undoAria: 'Übernommene Änderungen rückgängig machen',
    remove: 'Vorschlag entfernen: {{label}}',
    reason: 'Wegen: {{reason}}',
    fields: {
      dueDate: 'Fällig {{date}}',
      priorityHigh: 'Priorität hoch',
      priorityLow: 'Priorität niedrig',
      assignee: 'Zuständig: {{name}}',
      reference: '{{key}}: {{value}}',
      subtasks_one: '{{count}} Schritt',
      subtasks_other: '{{count}} Schritte',
      link: 'Verwandt: {{title}}',
    },
    /** The pending card's list of suggested fields (smarter capture, after Paper Wall v3). */
    rows: {
      title: 'Titel',
      text: 'Text',
      dueDate: 'Fällig',
      horizon: 'Wann',
      priority: 'Priorität',
      assignee: 'Person',
      visibility: 'Privat',
      privateValue: 'Nur du siehst sie',
      tag: 'Tag',
      step: 'Schritt',
      link: 'Verknüpft',
      leaveOut: 'Weglassen: {{label}}',
      bringBack: 'Wieder aufnehmen: {{label}}',
      list: 'Vorgeschlagene Felder',
      steps: 'Vorgeschlagene Schritte',
    },
    /** The pending card's footer: the countdown, Undo and Keep. */
    outcome: {
      nothing: 'Nichts zu ergänzen',
      busy: 'Gerade ausgelastet',
      limit: 'Limit erreicht',
      limitDaily: 'Tageslimit erreicht · wieder verfügbar ab {{when}}',
      limitMonthly: 'Monatslimit erreicht · wieder verfügbar ab {{when}}',
      saveFailed: 'Konnte nicht speichern',
      changed: 'Hat sich inzwischen geändert',
      tryAgain: 'Erneut versuchen',
      dismiss: 'Schließen',
    },
    footer: {
      asking: 'Wird ausgefüllt',
      saving: 'Speichert in {{count}} s',
      paused: 'Pausiert',
      keep: 'Behalten',
    },
    /** The note panel's review of a pending change, grouped by source (§3.4, plan R3, R4). */
    review: {
      kept: 'Übernommen.',
    },
  },
  /** Tidy on the horizon wall (RFC-0005-wallybot-inline.md §3.5). No name, no first person. */
  tidy: {
    failed: {
      saveFailed: 'Konnte die Notizen nicht verschieben',
      changed: 'Die Notizen haben sich inzwischen geändert',
      undoFailed: 'Konnte das Verschieben nicht rückgängig machen',
    },
    action_one: '{{count}} Notiz aufräumen',
    action_other: '{{count}} Notizen aufräumen',
    asking: 'Wird sortiert…',
    pending_one: '{{count}} Notiz wandert',
    pending_other: '{{count}} Notizen wandern',
    kept_one: '{{count}} Notiz verschoben',
    kept_other: '{{count}} Notizen verschoben',
    nothing: 'Alles an seinem Platz.',
    keep: 'Verschieben',
    discard: 'Verwerfen',
    undo: 'Rückgängig',
    barAria: 'Aufräumen',
    /** The destination line on a card: the zone it would move to. */
    moveTo: '→ {{zone}}',
    /** The tooltip of a move by date. */
    reasonDue: 'Fällig {{date}}',
    remove: 'Nicht verschieben',
    dotAria: 'Soll verschoben werden, wartet auf Enter',
  },
  /** The board home at /boards (RFC-0002 §7–§10). */
  home: {
    title: 'Deine Boards',
    shared: 'Mit dir geteilt',
    continue: 'Weitermachen',
    open: '{{name}} öffnen',
    openShared: '{{name}} öffnen, {{role}}',
    rowMenu: 'Optionen für {{name}}',
    newBoard: 'Neues Board',
    empty: {
      title: 'Noch keine Boards',
      hint: 'Lege eine an, um Notizen zu platzieren.',
    },
    create: {
      title: 'Neues Board',
      nameLabel: 'Name',
      submit: 'Anlegen',
      limitReached: 'Du hast die Grenze von {{max}} Boards erreicht.',
      failed: 'Konnte das Board nicht anlegen. Versuch es erneut.',
    },
    delete: {
      action: 'Board löschen',
      title: '„{{name}}“ löschen?',
      body_one:
        'Das entfernt das Board, seine {{count}} Notiz und den Zugang aller Mitglieder. Das lässt sich nicht rückgängig machen.',
      body_other:
        'Das entfernt das Board, seine {{count}} Notizen und den Zugang aller Mitglieder. Das lässt sich nicht rückgängig machen.',
      bodyCounting:
        'Das entfernt das Board, seine Notizen und den Zugang aller Mitglieder. Das lässt sich nicht rückgängig machen.',
      confirm: 'Board löschen',
    },
    leave: {
      action: 'Board verlassen',
      title: '„{{name}}“ verlassen?',
      body: 'Du brauchst eine neue Einladung oder einen Freigabelink, um zurückzukommen. Deine Zuweisungen auf diesem Board werden aufgehoben.',
      confirm: 'Board verlassen',
    },
  },
  routes: {
    home: {
      loadFailed: 'Konnte deine Wände nicht laden',
    },
    login: {
      title: 'Willkommen zurück',
      subtitle: 'Melde dich an, um deine Wände zu sehen.',
    },
    signup: {
      title: 'Konto erstellen',
      subtitle: 'Lege dein persönliches Whiteboard an.',
    },
    notFound: {
      title: 'Diese Seite gibt es nicht',
      body: 'Der Link ist vermutlich veraltet, oder die Wand wurde inzwischen gelöscht.',
      action: 'Zurück zu deinen Wänden',
    },
    redeem: {
      gone: {
        title: 'Dieser Link funktioniert nicht mehr',
        subtitle: 'Er wurde zurückgezogen oder durch einen neuen ersetzt.',
        body: 'Bitte die Person, die dir den Link geschickt hat, um einen neuen.',
      },
      failed: {
        title: 'Konnte den Link nicht öffnen',
        subtitle: 'Der Link konnte nicht eingelöst werden.',
        body: 'Versuch es erneut.',
      },
      pending: {
        title: 'Einen Moment',
        subtitle: 'Du wirst gerade zur Wand hinzugefügt.',
      },
      toBoard: 'Zu deinen Wänden',
    },
    board: {
      loadFailed: 'Konnte diese Wand nicht laden',
    },
  },
  share: {
    linkFailed: 'Konnte den Freigabelink nicht laden',
    inviteFailed: 'Konnte die Einladung nicht senden',
    scopeHint:
      'Eingeladene Personen erhalten nur Zugriff auf dieses Board. Sie werden nicht zu deiner Organisation hinzugefügt und erhalten keinen Zugriff auf andere Boards.',
    peopleAria: 'Personen auf diesem Board ({{count}})',
    peopleTitle: 'Personen auf diesem Board',
    peopleHint:
      'Personen mit Zugriff auf dieses Board. Ausstehende Einladungen findest du in den Freigaben.',
    membersFailed: 'Konnte die Mitglieder nicht laden',
    linkSection: 'Board-Link',
    enable: 'Link-Freigabe aktivieren',
    disable: 'Link deaktivieren',
    regenerate: 'Link erneuern',
    replace: 'Link ersetzen',
    regenerateHint:
      'Der alte Link funktioniert danach nicht mehr, und wer über ihn beigetreten ist, verliert den Zugang. Per E-Mail eingeladene Personen behalten ihn.',
    linkDisabled:
      'Die Link-Freigabe ist aus. Nur Personen, die bereits zu diesem Board hinzugefügt wurden, haben Zugriff.',
    linkSaveFailed:
      'Die Link-Einstellungen konnten nicht gespeichert werden. Bitte versuche es erneut.',
    linkUrlAria: 'Freigabelink für dieses Board',
    copyFailed: 'Konnte nicht kopieren. Markiere den Link und kopiere ihn.',
    trigger: 'Board teilen',
    title: '„{{name}}“ teilen',
    copy: 'Board-Link kopieren',
    copied: 'Kopiert',
    expiry: {
      DAYS_7: '7 Tage',
      DAYS_30: '30 Tage',
      NEVER: 'Nie',
    },
    expiryAria: 'Wie lange der Link gilt',
    changeExpiry: 'Ablauf ändern',
    expiresOn: 'Läuft ab am {{date}}',
    neverExpires: 'Läuft nie ab',
    linkMembersHint:
      'Wer über diesen Link beigetreten ist, verliert den Zugang, wenn der Link abläuft, neu erstellt oder deaktiviert wird.',
    linkRoleAria: 'Rolle für den Link',
    linkLabel: 'Jeder mit dem Link',
    linkHint: {
      EDIT: 'Jeder mit dem Link kann Notizen anlegen und verschieben.',
      VIEW: 'Jeder mit dem Link kann dieses Board ansehen.',
    },
    ownerOnly: 'Nur der Eigentümer kann Freigaben verwalten.',
    privateNotesHint: 'Mitglieder können private Notizen anlegen, die nur sie selbst sehen.',
    members: {
      pending: 'Ausstehend',
      joinedByLink: 'Über den Link beigetreten',
      roleAria: 'Rolle von {{name}}',
      remove: '{{name}} entfernen',
    },
    membersHeading: 'Personen mit Zugriff',
    invite: {
      placeholder: 'name@example.com',
      roleAria: 'Rolle',
      aria: 'E-Mail-Adresse einladen',
      submit: 'Zum Board einladen',
      pending: 'Lädt ein…',
    },
  },
  enums: {
    /**
     * Leaves are the raw persisted value, not a slug — the database stores these exact strings,
     * so keeping them visible here is what ties a label to the value it renders, and what
     * makes the `satisfies Record<Enum, string>` check in enumLabels.ts meaningful.
     */
    priority: {
      HIGH: 'Hoch',
      MEDIUM: 'Mittel',
      LOW: 'Niedrig',
    },
    horizon: {
      TODAY: 'Heute',
      THIS_WEEK: 'Diese Woche',
      LATER: 'Später',
    },
    colour: {
      CHALK: 'Kreide',
      ICE: 'Eisblau',
      STONE: 'Stein',
      MINT: 'Minze',
      SKY: 'Himmel',
      MIST: 'Nebel',
      OAT: 'Hafer',
      CLAY: 'Lehm',
      ROSE: 'Rosé',
      MALLOW: 'Malve',
      HEATHER: 'Heidekraut',
      SEA_GREEN: 'Seegrün',
      SAGE: 'Salbei',
      OLIVE: 'Oliv',
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
    visibility: {
      PRIVATE: 'Privat',
      SHARED: 'Für alle',
    },
  },
} as const;
