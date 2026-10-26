import type { Language } from '@wally/shared';

/**
 * The instant, local layer of capture (0005-wallybot-inline.md §3.2): dates, people and urgency
 * words found while typing, with no network. Pure and synchronous so it can run on every
 * keystroke. The first match of each kind wins; the title is never rewritten.
 */

export interface CaptureMember {
  id: string;
  displayName: string | null;
  email: string;
}
export interface CaptureMatch {
  start: number;
  end: number;
  text: string;
}
export interface CaptureParse {
  dueDate: (CaptureMatch & { iso: string }) | null;
  assignee: (CaptureMatch & { memberId: string }) | null;
  priority: (CaptureMatch & { value: 'HOCH' | 'NIEDRIG' }) | null;
}
interface Context {
  language: Language;
  today: Date;
  members: CaptureMember[];
}

const WEEKDAYS: Record<Language, { full: string[]; short: string[] }> = {
  de: {
    full: ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag'],
    short: ['so', 'mo', 'di', 'mi', 'do', 'fr', 'sa'],
  },
  en: {
    full: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
    short: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
  },
};
const RELATIVE: Record<Language, Record<string, number>> = {
  de: { heute: 0, morgen: 1, '\u00fcbermorgen': 2 },
  en: { today: 0, tomorrow: 1 },
};
const HIGH = ['dringend', 'sofort', 'asap', 'wichtig', 'urgent', 'important', 'high'];
const LOW = ['niedrig', 'irgendwann', 'low', 'someday'];

/**
 * Letters including umlauts (À-Ö, Ø-ö, ø-ÿ); `\b` alone treats ü as a boundary. German
 * vocabulary below is written with \u escapes so the hardcoded-copy guard stays meaningful:
 * these are words the parser reads, never copy it shows.
 */
const L = 'A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u00ff';
const NOT_AFTER_LETTER = `(?<![${L}])`;
const NOT_BEFORE_LETTER = `(?![${L}])`;
const word = (alternatives: string[]) =>
  new RegExp(`${NOT_AFTER_LETTER}(${alternatives.join('|')})${NOT_BEFORE_LETTER}`, 'gi');

const NEXT_WEEK: Record<Language, RegExp> = {
  de: new RegExp(`${NOT_AFTER_LETTER}n\u00e4chste\\s+woche${NOT_BEFORE_LETTER}`, 'gi'),
  en: new RegExp(`${NOT_AFTER_LETTER}next\\s+week${NOT_BEFORE_LETTER}`, 'gi'),
};
const IN_DAYS: Record<Language, RegExp> = {
  de: new RegExp(`${NOT_AFTER_LETTER}in\\s+(\\d{1,3})\\s+tag(?:en|e)?${NOT_BEFORE_LETTER}`, 'gi'),
  en: new RegExp(`${NOT_AFTER_LETTER}in\\s+(\\d{1,3})\\s+days?${NOT_BEFORE_LETTER}`, 'gi'),
};
const NEXT_WORD: Record<Language, string> = { de: 'n\u00e4chste[nrs]?', en: 'next' };
/** German short weekdays (`Mo`, `So`) are ordinary syllables, so they need a space or the end. */
const SHORT_END: Record<Language, string> = { de: '(?=\\s|$)', en: NOT_BEFORE_LETTER };
const WEEKDAY: Record<Language, RegExp> = {
  de: weekdayPattern('de'),
  en: weekdayPattern('en'),
};
function weekdayPattern(language: Language) {
  const { full, short } = WEEKDAYS[language];
  return new RegExp(
    `${NOT_AFTER_LETTER}(?:(${NEXT_WORD[language]})\\s+)?` +
      `(?:(${full.join('|')})${NOT_BEFORE_LETTER}|(${short.join('|')})${SHORT_END[language]})`,
    'gi',
  );
}
const ISO_DATE = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g;
const DOTTED_DATE = /(?<!\d)(\d{1,2})\.(\d{1,2})\.(\d{4})?(?!\d)/g;
const MENTION = /(^|\s)@([^\s@]+)/g;
const TRAILING_PUNCTUATION = /[.,;:!?)]+$/;
const escapeRegExp = (literal: string) => literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d: Date, n: number) => {
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  next.setDate(next.getDate() + n);
  return next;
};
/** A calendar date, or null when the day or month does not exist (31.11., 2026-13-40). */
const calendarDate = (year: number, month: number, day: number) => {
  const date = new Date(year, month, day);
  return date.getMonth() === month && date.getDate() === day ? date : null;
};
const span = (m: RegExpExecArray): CaptureMatch => ({
  start: m.index,
  end: m.index + m[0].length,
  text: m[0],
});
/** The first match of `re` that `read` accepts, with whatever `read` adds to it. */
function firstAccepted<T>(
  text: string,
  re: RegExp,
  read: (m: RegExpExecArray) => T | null,
): (CaptureMatch & T) | null {
  for (const m of text.matchAll(re)) {
    const extra = read(m);
    if (extra) return { ...span(m), ...extra };
  }
  return null;
}
/** The candidate that starts earliest in the text: the first match of each kind wins. */
function earliest<T extends CaptureMatch>(candidates: (T | null)[]): T | null {
  let best: T | null = null;
  for (const c of candidates) if (c && (!best || c.start < best.start)) best = c;
  return best;
}

function parseDate(text: string, ctx: Context): CaptureParse['dueDate'] {
  const { language, today } = ctx;
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const inDays = (n: number) => ({ iso: iso(addDays(todayMidnight, n)) });
  const { full, short } = WEEKDAYS[language];

  return earliest([
    firstAccepted(text, word(Object.keys(RELATIVE[language])), (m) =>
      inDays(RELATIVE[language][m[0].toLowerCase()]!),
    ),
    firstAccepted(text, NEXT_WEEK[language], () => inDays((8 - todayMidnight.getDay()) % 7 || 7)),
    firstAccepted(text, IN_DAYS[language], (m) => inDays(Number(m[1]))),
    firstAccepted(text, WEEKDAY[language], (m) => {
      const index = m[2] ? full.indexOf(m[2].toLowerCase()) : short.indexOf(m[3]!.toLowerCase());
      const ahead = (index - todayMidnight.getDay() + 7) % 7;
      // `next Friday` said on a Friday means a week from today, not today.
      return inDays(m[1] && ahead === 0 ? 7 : ahead);
    }),
    firstAccepted(text, ISO_DATE, (m) => {
      const date = calendarDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return date && { iso: iso(date) };
    }),
    firstAccepted(text, DOTTED_DATE, (m) => {
      const day = Number(m[1]);
      const month = Number(m[2]) - 1;
      if (m[3]) {
        const date = calendarDate(Number(m[3]), month, day);
        return date && { iso: iso(date) };
      }
      // This year's, unless it is past or does not exist (29.02. in a common year): then next
      // year's, which may not exist either (31.11.).
      const year = todayMidnight.getFullYear();
      const thisYear = calendarDate(year, month, day);
      const date =
        thisYear && thisYear >= todayMidnight ? thisYear : calendarDate(year + 1, month, day);
      return date && { iso: iso(date) };
    }),
  ]);
}

function parsePerson(text: string, members: CaptureMember[]): CaptureParse['assignee'] {
  const mention = (() => {
    for (const m of text.matchAll(MENTION)) {
      const handle = m[2]!.replace(TRAILING_PUNCTUATION, '');
      if (!handle) continue;
      const lower = handle.toLowerCase();
      const found = members.find((member) => {
        const name = (member.displayName ?? '').toLowerCase();
        const first = name.split(/\s+/)[0] ?? '';
        const local = member.email.toLowerCase().split('@')[0] ?? '';
        // A handle has no spaces, so a match on the full name is a match on the first name.
        return (first && first.startsWith(lower)) || local.startsWith(lower);
      });
      if (!found) continue;
      const start = m.index + m[1]!.length;
      return { start, end: start + 1 + handle.length, text: `@${handle}`, memberId: found.id };
    }
    return null;
  })();
  const byFullName = members.map((member) =>
    member.displayName?.includes(' ')
      ? firstAccepted(text, word([escapeRegExp(member.displayName)]), () => ({
          memberId: member.id,
        }))
      : null,
  );
  return earliest([mention, ...byFullName]);
}

function parsePriority(text: string): CaptureParse['priority'] {
  return firstAccepted(text, word([...HIGH, ...LOW]), (m) => ({
    value: HIGH.includes(m[0].toLowerCase()) ? ('HOCH' as const) : ('NIEDRIG' as const),
  }));
}

export function parseCapture(text: string, ctx: Context): CaptureParse {
  if (!text.trim()) return { dueDate: null, assignee: null, priority: null };
  return {
    dueDate: parseDate(text, ctx),
    assignee: parsePerson(text, ctx.members),
    priority: parsePriority(text),
  };
}
