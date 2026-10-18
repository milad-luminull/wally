import type { TFunction } from 'i18next';

export type Tray = 'today' | 'week' | 'meet' | 'ideas';
export type DemoPhase = 'typing' | 'idle' | 'thinking' | 'review' | 'kept';
export interface DemoState {
  phase: DemoPhase;
  phrase: number;
  typed: number;
  elapsed: number;
  raw: string;
  input: string;
  manual: boolean;
  voice: boolean;
  tray: Tray;
  trays: Record<Tray, number>;
}
export const initialDemo: DemoState = {
  phase: 'typing',
  phrase: 0,
  typed: 0,
  elapsed: 0,
  raw: '',
  input: '',
  manual: false,
  voice: false,
  tray: 'week',
  trays: { today: 2, week: 3, meet: 1, ideas: 1 },
};
type Action =
  | { type: 'tick'; phrase: string; tray: Tray }
  | { type: 'input'; value: string }
  | { type: 'focus' }
  | { type: 'start'; raw: string; instant: boolean }
  | { type: 'voice' }
  | { type: 'keep'; tray: Tray; instant: boolean }
  | { type: 'undo' };

// This state belongs only to the marketing demo. It never uses notesApi or stored boards.
export function demoReducer(s: DemoState, a: Action): DemoState {
  switch (a.type) {
    case 'input':
      return { ...s, input: a.value, manual: true };
    case 'focus':
      return s.manual ? s : { ...s, manual: true, phase: 'idle', raw: '', input: '', voice: false };
    case 'voice':
      return {
        ...s,
        phase: 'typing',
        phrase: 1,
        typed: 0,
        elapsed: 0,
        raw: '',
        input: '',
        manual: false,
        voice: true,
      };
    case 'start':
      return {
        ...s,
        raw: a.raw,
        input: '',
        phase: a.instant ? 'review' : 'thinking',
        elapsed: 0,
        manual: true,
        voice: false,
      };
    case 'undo':
      return { ...s, phase: 'idle', input: s.raw, raw: '', manual: true, voice: false, elapsed: 0 };
    case 'keep':
      return {
        ...s,
        phase: a.instant ? 'idle' : 'kept',
        elapsed: 0,
        tray: a.tray,
        trays: { ...s.trays, [a.tray]: s.trays[a.tray] + 1 },
      };
    case 'tick': {
      const elapsed = s.elapsed + 90;
      if (s.phase === 'typing' && !s.manual) {
        if (s.typed < a.phrase.length) {
          const voice = s.voice || s.phrase % 6 === 1 || s.phrase % 6 === 4;
          const word = a.phrase.indexOf(' ', s.typed + 1);
          return {
            ...s,
            typed: voice ? (word < 0 ? a.phrase.length : word) : s.typed + 1,
            elapsed: 0,
          };
        }
        if (elapsed >= 630)
          return { ...s, phase: 'thinking', raw: a.phrase, elapsed: 0, voice: false };
      } else if (s.phase === 'thinking' && elapsed >= 2700) {
        return { ...s, phase: 'review', elapsed: 0 };
      } else if (s.phase === 'review' && elapsed >= 4050) {
        return demoReducer(s, { type: 'keep', tray: a.tray, instant: false });
      } else if (s.phase === 'kept' && elapsed >= 1440) {
        return {
          ...s,
          phase: s.manual ? 'idle' : 'typing',
          typed: 0,
          raw: '',
          elapsed: 0,
          phrase: (s.phrase + 1) % 6,
        };
      }
      return s.phase === 'idle' ? s : { ...s, elapsed };
    }
  }
}

/** A small, deterministic illustration of the reference, not the app's AI parser. */
export function demoNote(raw: string, t: TFunction) {
  const text = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const isIdea = /^(idea|idee)\b/.test(text);
  const clock = text.match(/\b(\d{1,2})(?::(\d{2}))?\s?(am|pm|uhr)\b/);
  const isMeeting = !!clock || /\b(meeting|call|besprechung|anruf)\b/.test(text);
  const kind = isIdea ? 'note' : isMeeting ? 'meeting' : 'todo';
  const days = [
    [/\b(today|heute)\b/, 'today'],
    [/\b(tomorrow|morgen)\b/, 'tomorrow'],
    [/\b(next week|nachste woche)\b/, 'next'],
    [/\b(mon\w*|mo|montag)\b/, 'mon'],
    [/\b(tue\w*|di|dienstag)\b/, 'tue'],
    [/\b(wed\w*|mi|mittwoch)\b/, 'wed'],
    [/\b(thu\w*|do|donnerstag)\b/, 'thu'],
    [/\b(fri\w*|fr|freitag)\b/, 'fri'],
  ] as const;
  const due = days.find(([pattern]) => pattern.test(text))?.[1];
  const person = /\b(maya|leo|sam)\b/.exec(text)?.[1];
  const names: Record<string, string> = { maya: 'Maya Chen', leo: 'Leo Martin', sam: 'Sam Ortiz' };
  const who = person ? names[person]!.split(' ')[0]! : t('landing.demo.someone');
  const verb = isIdea
    ? 'idea'
    : /\b(review|prufen|prufung)\b/.test(text)
      ? 'review'
      : /\b(call|anruf)\b/.test(text)
        ? 'call'
        : isMeeting
          ? 'meeting'
          : /\b(send|senden|angebot)\b/.test(text)
            ? 'send'
            : /\b(book|buchen)\b/.test(text)
              ? 'book'
              : 'other';
  const colour = isIdea ? 'rose' : isMeeting ? 'himmel' : verb === 'book' ? 'minze' : 'butter';
  const tray: Tray = isIdea
    ? 'ideas'
    : isMeeting
      ? 'meet'
      : due === 'today' || due === 'tomorrow'
        ? 'today'
        : 'week';
  let title = raw
    .replace(/^(idea|idee):\s*/i, '')
    .replace(/^remind me to\s+/i, '')
    .replace(/^set up a call/i, 'Call')
    .replace(/\b\d{1,2}(:\d{2})?\s?(am|pm|uhr)\b/gi, '')
    .replace(
      /\b(today|tomorrow|next week|mon\w*|tue\w*|wed\w*|thu\w*|fri\w*|heute|morgen|mo|di|mi|do|fr|montag|dienstag|mittwoch|donnerstag|freitag)\b/gi,
      '',
    )
    .replace(/\b(urgent|asap|important|dringend|wichtig)\b/gi, '')
    .replace(/\b\d+\s?(m|min|h)\b/gi, '')
    .replace(/,?\s*it takes\s*$/i, '')
    .replace(/\s(on|at|am|um)(?=\s+(?:on|at|about|zum)\b|\s*$)/gi, '')
    .replace(/\b(maya|leo|sam)\b/gi, (name) => name[0]!.toUpperCase() + name.slice(1).toLowerCase())
    .replace(/\bq([1-4])\b/gi, 'Q$1')
    .replace(/\s+/g, ' ')
    .trim();
  title = title ? title[0]!.toUpperCase() + title.slice(1) : raw;
  const duration = /\b(\d+)\s?(m|min|h)\b/.exec(text);
  const minutes = duration
    ? Number(duration[1]) * (duration[2] === 'h' ? 60 : 1)
    : isMeeting
      ? 60
      : verb === 'send'
        ? 15
        : 30;
  const fields: { label: string; value: string }[] = [
    { label: t('landing.demo.fields.type'), value: t(`landing.demo.kind.${kind}`) },
  ];
  if (due)
    fields.push({
      label: t(`landing.demo.fields.${isMeeting ? 'when' : 'due'}`),
      value: t(`landing.demo.days.${due}`) + (clock ? ` · ${clock[0]}` : ''),
    });
  if (person) fields.push({ label: t('landing.demo.fields.with'), value: names[person]! });
  if (isIdea)
    fields.push({ label: t('landing.demo.fields.filed'), value: t('landing.demo.ideas') });
  if (kind === 'todo')
    fields.push(
      {
        label: t('landing.demo.fields.priority'),
        value: t(
          /urgent|asap|important|dringend|wichtig/.test(text)
            ? 'landing.demo.high'
            : 'landing.demo.medium',
        ),
      },
      {
        label: t('landing.demo.fields.takes'),
        value: t('landing.demo.duration', { count: minutes }),
      },
    );
  return {
    title,
    kind,
    colour,
    tray,
    fields,
    subs: t('landing.demo.subs', { returnObjects: true, who })[verb],
  } as const;
}
