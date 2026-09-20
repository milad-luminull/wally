/** English copy. Held to the German catalogue's key set by resources.test.ts. */
export const en = {
  app: {
    title: 'Wally — My Board',
  },
  common: {
    close: 'Close',
    cancel: 'Cancel',
    delete: 'Delete',
    retry: 'Try again',
    loading: 'Loading…',
    untitled: 'Untitled',
    or: 'or',
    shortDate: '{{date, datetime(day: 2-digit; month: 2-digit)}}',
  },
  board: {
    switcher: {
      ownRole: 'Your board',
    },
    group: {
      all: 'All notes',
    },
    due: {
      done: 'Done',
      none: 'No date',
      today: 'Today',
      tomorrow: 'Tomorrow',
      overdue: 'Overdue {{date, datetime(day: 2-digit; month: 2-digit)}}',
    },
  },
  enums: {
    priority: {
      HOCH: 'High',
      MITTEL: 'Medium',
      NIEDRIG: 'Low',
    },
    horizon: {
      HEUTE: 'Today',
      DIESE_WOCHE: 'This week',
      SPAETER: 'Later',
    },
    colour: {
      WEISS: 'None',
      EIS: 'Ice blue',
      SAND: 'Sand',
      MINZE: 'Mint',
      HIMMEL: 'Sky',
      NEBEL: 'Mist',
      BUTTER: 'Butter',
      LEHM: 'Clay',
      ROSE: 'Rose',
      MALVE: 'Mallow',
      FLIEDER: 'Lilac',
      SEEGRUEN: 'Sea green',
      SALBEI: 'Sage',
      OLIV: 'Olive',
    },
    whiteboardRole: {
      VIEW: 'Can view',
      EDIT: 'Can edit',
    },
    effectiveRole: {
      OWNER: 'Owner',
      EDIT: 'Can edit',
      VIEW: 'Can view',
    },
  },
} as const;
