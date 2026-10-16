# Write in Place Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person writes a note's title and text directly on the board, where the note will live, with no sidebar; dates, people and urgency words are recognised as they type and offered as chips; Enter commits, the sidebar stays the optional detail layer. No AI in this slice.

**Architecture:** One capture component (`InlineCaptureCard`) that is mounted in place of a note card on the wall, in a zone, or as a row at the top of the list, owned by a small controller hook (`useCapture`) with the states `idle → drafting → creating → committing`. The note is created on the first keystroke through the existing optimistic `useCreateNote`, so nothing typed is ever lost; the commit sends one `update_note` with the final title, text and kept fields, plus `assign_note` when a person chip is kept. A pure, synchronous parser (`parseCapture`) finds dates, people and urgency on every keystroke with no network. Every entry point that creates a note today (`N`, the New note button, a double-click on the canvas, a zone's plus button) starts a capture instead of opening the sidebar.

**Tech Stack:** React 19, react-router 8, TanStack Query 5, Tailwind with the Graphite + Marigold tokens, react-i18next, Vitest + Testing Library. No new dependency.

**Spec:** `docs/rfcs/WALLYBOT_INLINE.md` §3.1, §3.2 and §7 (accepted 2026-10-16; read it at `/Users/mr_user/development/apps/wally-docs-rfc-agent/docs/rfcs/WALLYBOT_INLINE.md`). Design authority: `docs/BRAND.md` ("Components", "Keyboard", "Voice", "Shape, depth and motion"). Product requirements: `docs/SPEC.md` §2 (notes), the private-notes rules (a VIEW member creates private notes).

## Context

The customer feedback: the title and text of a card should be written on the board itself; the sidebar is for more details. Today every creation path makes an empty note and opens the sidebar. The design "Wallybot Inline" shows the typing state as a card on the wall reading "call andrea about munich re" with "↵ to create" under it, and a kept note that looks like any other. This slice delivers exactly that, without the AI layer that slice 2 adds on top.

Decisions taken for this plan, each with its reason:

- **The parser lives in `apps/web/src/lib/capture/`**, not in `packages/shared`: the shared package has no test runner, and adding one is a new dependency. The parser is client-only in this slice; moving it later is a file move.
- **The capture card is its own component**, never a mode of `NoteCard`: `NoteCard.test.tsx` documents that a note card must carry no mount animation because cards re-parent during drag. The capture card is replaced by the real card on commit, so it may animate in.
- **The note is created on the first keystroke**, not on `N`: pressing `N` and leaving must not litter the board with untitled notes. Until the first keystroke the capture is local; the first keystroke creates the note (optimistic temp id, swapped on success); the commit updates it. Esc or blur before any keystroke just closes the card; Esc after typing deletes the note (the person chose to abandon it); blur with a non-empty title commits.
- **The title stays as typed.** The parser adds fields; it never rewrites the person's words. Cleaning the title is the AI's job in slice 2 and is offered, never applied.
- **Matched words are underlined** in the field with a mirrored overlay (a `div` behind a transparent-text `textarea`), the standard technique; chips under the line are the proposals. Both read in the note's own type and colour.
- **Kept chips apply on Enter** as fields: a date chip sets `dueDate`, a priority chip sets `priority`, a person chip assigns. Default kept; a tap toggles; `×` removes. Nothing is applied before Enter.
- **The sidebar opens** on a click on a committed card as today, or with `⌘↵` while capturing (commit, then open).

## Global Constraints

- Work only in `/Users/mr_user/development/apps/wally-capture`, branch `feat/capture-inline` (parent `main`). Never run git or edit files in `/Users/mr_user/development/apps/wally` (bind-mounted into the running stack) or in `/Users/mr_user/development/apps/wally-assistant` (another slice's worktree with running preview servers).
- Web tests run on the host and touch no emulator: `cd /Users/mr_user/development/apps/wally-capture/apps/web && pnpm vitest run <file>`, one file at a time while iterating. Never run any docker or docker compose command.
- Checks, from the worktree root: `pnpm --filter @wally/web typecheck`, `pnpm --filter @wally/web lint`, `pnpm format:check` (fix with `pnpm format`). The guard tests must stay green: `src/brandGuards.test.ts`, `src/i18n/noHardcodedCopy.test.ts`, `src/i18n/resources.test.ts`, `src/i18n/englishSurface.test.tsx`, and `src/features/board/WandView/NoteCard.test.tsx` (no mount animation on note cards).
- No new dependency. No API change: creation and update go through `notesApi.create`, `notesApi.update`, `notesApi.assign`, `notesApi.remove` exactly as the existing hooks call them.
- Every visible or screen-reader string comes from the catalogues (`de.ts` is the key authority, `en.ts` mirrors every key); no literal copy in components.
- BRAND.md: the capture card uses the note surface (`rounded-lg border p-3`, the WEISS fill, the `--note-border` hairline), 14/500 for the title, 12 for text and hints, no marigold anywhere in it (the board's "New note" keeps the accent), status colour only on a due-date chip's text, motion 120–180 ms on transform and opacity only and off under reduced motion, controls at least 40 px on a coarse pointer.
- Keyboard: `N` starts a capture; Enter commits; Shift+Enter starts the description line; Esc cancels; `⌘↵` commits and opens the sidebar; single keys never fire while typing (the capture field is a typing target).
- A VIEW member's capture creates a private note (`access.newNoteVisibility`), as every creation path does today.
- Conventional Commits; never commit to `main`. Commit with `git -c core.hooksPath=/dev/null commit`. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Prettier: single quotes, trailing commas, width 100.

## Review Focus

1. `N` pressed and then Esc, or `N` and a click elsewhere, with nothing typed: no note is created and no request is sent. Test in Task 2.
2. Typing "Müller anrufen Freitag @anna dringend" shows three chips (the coming Friday, Anna, high priority) and underlines the three matches; removing the person chip and pressing Enter sets the due date and priority and does not assign. Tests in Tasks 1 and 2.
3. A title that is only whitespace does not commit on Enter and the card stays; on blur the empty note is deleted. Test in Task 2.
4. A double-click on the free canvas places the capture card at the click point and the committed note appears at that position; a zone's plus button places the committed note in that zone. Test in Task 3.
5. The sidebar never opens on commit unless `⌘↵` was used; a click on the committed card opens it as before. Test in Task 3.

---

### Task 1: The capture parser

**Files:**

- Create: `apps/web/src/lib/capture/parseCapture.ts`
- Test: `apps/web/src/lib/capture/parseCapture.test.ts`

**Interfaces:**

- Consumes: `Language` from `@wally/shared`.
- Produces:

```ts
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
  dueDate: (CaptureMatch & { iso: string }) | null; // 'YYYY-MM-DD' in the person's calendar
  assignee: (CaptureMatch & { memberId: string }) | null;
  priority: (CaptureMatch & { value: 'HOCH' | 'NIEDRIG' }) | null;
}
export function parseCapture(
  text: string,
  ctx: { language: Language; today: Date; members: CaptureMember[] },
): CaptureParse;
```

Rules the implementation follows (German and English, case-insensitive, whole words only, the first match of each kind wins):

- Dates: `heute`/`today`, `morgen`/`tomorrow`, `übermorgen`, weekday names in full and short form (`Montag`…`Sonntag`, `Mo`…`So` only with a following space or end, `Monday`…`Sunday`, `Mon`…`Sun`), `nächste Woche`/`next week` (the coming Monday), `in N Tagen`/`in N days`, `DD.MM.` and `DD.MM.YYYY`, `YYYY-MM-DD`. A weekday means the next occurrence after today (today itself if it is that weekday); `nächsten Freitag`/`next Friday` means the same. `DD.MM.` without a year means this year, or next year if the date has passed.
- People: `@` followed by a word matches a member whose display name's first word, full display name, or email local part starts with it (case-insensitive); the match covers the `@` and the word. Without `@`, a member's full display name appearing as whole words also matches.
- Urgency: `dringend`, `sofort`, `asap`, `wichtig`, `urgent`, `important`, `high` → `HOCH`; `niedrig`, `irgendwann`, `low`, `someday` → `NIEDRIG`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/capture/parseCapture.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseCapture, type CaptureMember } from './parseCapture';

// 2026-10-16 is a Friday.
const today = new Date(2026, 9, 16, 12, 0, 0);
const members: CaptureMember[] = [
  { id: 'u-anna', displayName: 'Anna Kowalski', email: 'anna@example.com' },
  { id: 'u-max', displayName: null, email: 'max.mustermann@example.com' },
];
const de = (text: string) => parseCapture(text, { language: 'de', today, members });
const en = (text: string) => parseCapture(text, { language: 'en', today, members });

describe('parseCapture dates', () => {
  it('reads relative words in German and English', () => {
    expect(de('Müller anrufen heute').dueDate).toMatchObject({ iso: '2026-10-16', text: 'heute' });
    expect(de('morgen Angebot').dueDate).toMatchObject({ iso: '2026-10-17', text: 'morgen' });
    expect(de('übermorgen').dueDate?.iso).toBe('2026-10-18');
    expect(en('call Anna tomorrow').dueDate).toMatchObject({ iso: '2026-10-17', text: 'tomorrow' });
    expect(en('today').dueDate?.iso).toBe('2026-10-16');
  });
  it('reads weekdays as the next occurrence, today included', () => {
    expect(de('bis Freitag').dueDate).toMatchObject({ iso: '2026-10-16', text: 'Freitag' });
    expect(de('am Montag').dueDate?.iso).toBe('2026-10-19');
    expect(de('nächsten Dienstag').dueDate?.iso).toBe('2026-10-20');
    expect(en('by Monday').dueDate?.iso).toBe('2026-10-19');
    expect(en('next Fri').dueDate?.iso).toBe('2026-10-23');
    expect(de('Mo Bericht').dueDate?.iso).toBe('2026-10-19');
    expect(de('Montagsbesprechung').dueDate).toBeNull();
  });
  it('reads next week, in N days and numeric dates', () => {
    expect(de('nächste Woche').dueDate?.iso).toBe('2026-10-19');
    expect(en('next week').dueDate?.iso).toBe('2026-10-19');
    expect(de('in 3 Tagen').dueDate?.iso).toBe('2026-10-19');
    expect(en('in 10 days').dueDate?.iso).toBe('2026-10-26');
    expect(de('am 20.10.').dueDate).toMatchObject({ iso: '2026-10-20', text: '20.10.' });
    expect(de('am 3.1.').dueDate?.iso).toBe('2027-01-03');
    expect(de('am 20.10.2027').dueDate?.iso).toBe('2027-10-20');
    expect(en('on 2026-11-02').dueDate?.iso).toBe('2026-11-02');
  });
  it('records the position of the match', () => {
    const p = de('Müller anrufen Freitag');
    expect(p.dueDate).toMatchObject({ start: 15, end: 22 });
  });
});

describe('parseCapture people', () => {
  it('matches @mentions by first name, full name or email', () => {
    expect(de('Vertrag @anna').assignee).toMatchObject({ memberId: 'u-anna', text: '@anna' });
    expect(de('@Anna Kowalski fragen').assignee?.memberId).toBe('u-anna');
    expect(en('ask @max.mustermann').assignee?.memberId).toBe('u-max');
    expect(de('@niemand').assignee).toBeNull();
  });
  it('matches a full display name without @', () => {
    expect(de('Anna Kowalski anrufen').assignee).toMatchObject({
      memberId: 'u-anna',
      text: 'Anna Kowalski',
    });
    expect(de('Anna anrufen').assignee).toBeNull();
  });
});

describe('parseCapture urgency', () => {
  it('maps urgency words to a priority', () => {
    expect(de('dringend Müller anrufen').priority).toMatchObject({
      value: 'HOCH',
      text: 'dringend',
    });
    expect(en('urgent: call back').priority?.value).toBe('HOCH');
    expect(de('irgendwann Keller aufräumen').priority?.value).toBe('NIEDRIG');
    expect(en('someday read that book').priority?.value).toBe('NIEDRIG');
    expect(de('Hochzeit planen').priority).toBeNull();
  });
});

describe('parseCapture together', () => {
  it('finds all three in one line and nothing in plain text', () => {
    const p = de('Müller anrufen Freitag @anna dringend');
    expect(p.dueDate?.iso).toBe('2026-10-16');
    expect(p.assignee?.memberId).toBe('u-anna');
    expect(p.priority?.value).toBe('HOCH');
    expect(de('Blumen gießen')).toEqual({ dueDate: null, assignee: null, priority: null });
    expect(de('')).toEqual({ dueDate: null, assignee: null, priority: null });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/mr_user/development/apps/wally-capture/apps/web && pnpm vitest run src/lib/capture/parseCapture.test.ts`
Expected: FAIL, cannot find module `./parseCapture`.

- [ ] **Step 3: Write the parser**

Create `apps/web/src/lib/capture/parseCapture.ts`:

```ts
import type { Language } from '@wally/shared';

/**
 * The instant, local layer of capture (WALLYBOT_INLINE.md §3.2): dates, people and urgency
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
  de: { heute: 0, morgen: 1, übermorgen: 2 },
  en: { today: 0, tomorrow: 1 },
};
const NEXT_WEEK: Record<Language, RegExp> = {
  de: /\bnächste\s+woche\b/i,
  en: /\bnext\s+week\b/i,
};
const IN_DAYS: Record<Language, RegExp> = {
  de: /\bin\s+(\d{1,3})\s+tagen?\b/i,
  en: /\bin\s+(\d{1,3})\s+days?\b/i,
};
const NEXT_WORD: Record<Language, string> = { de: 'nächste[nrs]?', en: 'next' };
const HIGH = ['dringend', 'sofort', 'asap', 'wichtig', 'urgent', 'important', 'high'];
const LOW = ['niedrig', 'irgendwann', 'low', 'someday'];

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d: Date, n: number) => {
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  next.setDate(next.getDate() + n);
  return next;
};
const match = (text: string, re: RegExp): CaptureMatch | null => {
  const m = re.exec(text);
  return m ? { start: m.index, end: m.index + m[0].length, text: m[0] } : null;
};
/** Letters including umlauts; `\b` alone treats ü as a boundary. */
const L = 'A-Za-zÀ-ÖØ-öø-ÿ';
const word = (alternatives: string[]) =>
  new RegExp(`(?<![${L}])(${alternatives.join('|')})(?![${L}])`, 'i');

function parseDate(text: string, ctx: Context): CaptureParse['dueDate'] {
  const { language, today } = ctx;
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const relative = match(text, word(Object.keys(RELATIVE[language])));
  if (relative)
    return {
      ...relative,
      iso: iso(addDays(todayMidnight, RELATIVE[language][relative.text.toLowerCase()]!)),
    };

  const nextWeek = match(text, NEXT_WEEK[language]);
  if (nextWeek) {
    const daysToMonday = (8 - todayMidnight.getDay()) % 7 || 7;
    return { ...nextWeek, iso: iso(addDays(todayMidnight, daysToMonday)) };
  }

  const inDays = IN_DAYS[language].exec(text);
  if (inDays)
    return {
      start: inDays.index,
      end: inDays.index + inDays[0].length,
      text: inDays[0],
      iso: iso(addDays(todayMidnight, Number(inDays[1]))),
    };

  const { full, short } = WEEKDAYS[language];
  const weekday = match(
    text,
    new RegExp(
      `(?:\\b${NEXT_WORD[language]}\\s+)?(?<![${L}])(${[...full, ...short].join('|')})(?![${L}])`,
      'i',
    ),
  );
  if (weekday) {
    const name = weekday.text.toLowerCase().split(/\s+/).pop()!;
    const index = full.indexOf(name) >= 0 ? full.indexOf(name) : short.indexOf(name);
    const ahead = (index - todayMidnight.getDay() + 7) % 7;
    return { ...weekday, iso: iso(addDays(todayMidnight, ahead)) };
  }

  const isoDate = match(text, /\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoDate) return { ...isoDate, iso: isoDate.text };

  const dotted = /(?<!\d)(\d{1,2})\.(\d{1,2})\.(\d{4})?(?!\d)/.exec(text);
  if (dotted) {
    const day = Number(dotted[1]);
    const month = Number(dotted[2]) - 1;
    let year = dotted[3] ? Number(dotted[3]) : todayMidnight.getFullYear();
    let date = new Date(year, month, day);
    if (!dotted[3] && date < todayMidnight) date = new Date(++year, month, day);
    if (date.getMonth() !== month) return null;
    return {
      start: dotted.index,
      end: dotted.index + dotted[0].length,
      text: dotted[0],
      iso: iso(date),
    };
  }
  return null;
}

function parsePerson(text: string, members: CaptureMember[]): CaptureParse['assignee'] {
  const mention = /(^|\s)(@([^\s@]+))/.exec(text);
  if (mention) {
    const handle = mention[3]!.toLowerCase();
    const found = members.find((m) => {
      const name = (m.displayName ?? '').toLowerCase();
      const first = name.split(/\s+/)[0] ?? '';
      const local = m.email.toLowerCase().split('@')[0] ?? '';
      return (
        (name && name.startsWith(handle)) ||
        (first && first.startsWith(handle)) ||
        local.startsWith(handle)
      );
    });
    if (!found) return null;
    const start = mention.index + mention[1]!.length;
    return { start, end: start + mention[2]!.length, text: mention[2]!, memberId: found.id };
  }
  for (const m of members) {
    if (!m.displayName || !m.displayName.includes(' ')) continue;
    const hit = match(text, word([m.displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')]));
    if (hit) return { ...hit, memberId: m.id };
  }
  return null;
}

function parsePriority(text: string): CaptureParse['priority'] {
  const high = match(text, word(HIGH));
  if (high) return { ...high, value: 'HOCH' };
  const low = match(text, word(LOW));
  if (low) return { ...low, value: 'NIEDRIG' };
  return null;
}

export function parseCapture(text: string, ctx: Context): CaptureParse {
  if (!text.trim()) return { dueDate: null, assignee: null, priority: null };
  return {
    dueDate: parseDate(text, ctx),
    assignee: parsePerson(text, ctx.members),
    priority: parsePriority(text),
  };
}
```

Resolve any test the draft fails by fixing the parser, never by weakening the test; the tests are the contract. Two points to watch: the short weekday forms must not match inside words (`Montagsbesprechung`, `Hochzeit`), which the lookarounds handle; and `next Fri` must resolve to the following Friday when today is Friday (the `next` prefix adds seven days when `ahead` is 0).

- [ ] **Step 4: Run the tests to verify they pass**

Run the command from Step 2. Expected: PASS, all tests.

- [ ] **Step 5: Checks and commit**

Run from the worktree root: `pnpm --filter @wally/web typecheck && pnpm --filter @wally/web lint && pnpm format:check` (run `pnpm format` first if needed). Expected: pass.

```bash
cd /Users/mr_user/development/apps/wally-capture && git add apps/web/src/lib/capture/parseCapture.ts apps/web/src/lib/capture/parseCapture.test.ts && git -c core.hooksPath=/dev/null commit -m "feat(web): capture parser for dates, people and urgency words" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The capture card and its controller

**Files:**

- Modify: `apps/web/src/i18n/de.ts`, `apps/web/src/i18n/en.ts` (new `capture` block)
- Create: `apps/web/src/features/board/Capture/useCapture.ts`
- Create: `apps/web/src/features/board/Capture/CaptureChips.tsx`
- Create: `apps/web/src/features/board/Capture/InlineCaptureCard.tsx`
- Modify: `apps/web/tailwind.config.ts` (one keyframe and animation, `capture-in`)
- Test: `apps/web/src/features/board/Capture/InlineCaptureCard.test.tsx`

**Interfaces:**

- Consumes: `parseCapture` (Task 1); `useCreateNote`, `useUpdateNote`, `useAssignNote`, `useDeleteNote` from `../hooks/mutations/`; `useActiveMembers`; `useLanguage` for the profile language; `noteColourFillClass`, `dueInfo`, `dueToneClass`; `cn`.
- Produces:

```tsx
// useCapture.ts
export type CapturePlacement =
  | { kind: 'free'; x: number; y: number }
  | {
      kind: 'zone';
      axis: 'horizon' | 'priority';
      key: string;
      at: { freeX: number; freeY: number };
    }
  | { kind: 'list' };
export interface CaptureFields {
  dueDate: string | null;
  assigneeId: string | null;
  priority: 'HOCH' | 'NIEDRIG' | null;
}
export interface CaptureController {
  state: 'drafting' | 'creating' | 'committing';
  noteId: string | null; // null until the first keystroke's create resolves
  onFirstKeystroke: (title: string) => void;
  commit: (
    draft: { title: string; description: string; fields: CaptureFields },
    thenOpen: boolean,
  ) => Promise<void>;
  cancel: () => Promise<void>; // deletes the note if one was created
}
export function useCapture(
  boardId: string,
  placement: CapturePlacement,
  visibility: NoteVisibility,
  callbacks: { onDone: (noteId: string | null, open: boolean) => void },
): CaptureController;

// InlineCaptureCard.tsx
export function InlineCaptureCard(props: {
  boardId: string;
  placement: CapturePlacement;
  visibility: NoteVisibility;
  layout: 'card' | 'row';
  onDone: (noteId: string | null, open: boolean) => void; // null when cancelled
}): JSX.Element;
```

Catalogue keys (German is the authority; English mirrors):

```ts
  capture: {
    cardAria: 'Neue Notiz schreiben',
    titleAria: 'Titel der neuen Notiz',
    descriptionAria: 'Text der neuen Notiz',
    hint: '↵ anlegen · ⇧↵ Text · Esc verwerfen',
    hintCoarse: 'Enter legt die Notiz an',
    chips: {
      due: 'Fällig {{date}}',
      assignee: 'Zuständig: {{name}}',
      priorityHigh: 'Priorität hoch',
      priorityLow: 'Priorität niedrig',
      keep: 'Vorschlag übernehmen',
      drop: 'Vorschlag entfernen',
      dropped: 'Entfernt',
    },
  },
```

English: cardAria 'Write a new note', titleAria 'Title of the new note', descriptionAria 'Text of the new note', hint '↵ create · ⇧↵ text · Esc discard', hintCoarse 'Enter creates the note', chips { due 'Due {{date}}', assignee 'Assigned to {{name}}', priorityHigh 'High priority', priorityLow 'Low priority', keep 'Keep suggestion', drop 'Remove suggestion', dropped 'Removed' }. The title placeholder reuses `note.titlePlaceholder`, the description placeholder `note.descriptionPlaceholder`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/features/board/Capture/InlineCaptureCard.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NoteDto } from '@wally/shared';

vi.mock('@/lib/resources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/resources')>()),
  notesApi: {
    create: vi.fn(),
    update: vi.fn(),
    assign: vi.fn(),
    remove: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
  },
  membersApi: { list: vi.fn() },
}));
vi.mock('@/i18n/LanguageProvider', async () => {
  const actual =
    await vi.importActual<typeof import('@/i18n/LanguageProvider')>('@/i18n/LanguageProvider');
  return {
    ...actual,
    useLanguage: () => ({
      language: 'de',
      setLanguage: vi.fn(),
      isSaving: false,
      saveFailed: false,
    }),
  };
});

import { membersApi, notesApi } from '@/lib/resources';
import { renderWithProviders } from '@/test/renderWithProviders';
import { makeNote } from '@/test/fixtures';
import { InlineCaptureCard } from './InlineCaptureCard';

const created = (overrides: Partial<NoteDto> = {}) =>
  makeNote({ id: 'n-new', revision: 1, title: 'Müller anrufen', ...overrides });

function renderCard(layout: 'card' | 'row' = 'card') {
  const onDone = vi.fn();
  renderWithProviders(
    <InlineCaptureCard
      boardId="b1"
      placement={{ kind: 'free', x: 10, y: 20 }}
      visibility="SHARED"
      layout={layout}
      onDone={onDone}
    />,
  );
  return { onDone };
}

describe('InlineCaptureCard', () => {
  beforeEach(() => {
    vi.mocked(notesApi.create).mockReset().mockResolvedValue(created());
    vi.mocked(notesApi.update)
      .mockReset()
      .mockImplementation(async (_id, input) =>
        created({ ...(input as object) } as Partial<NoteDto>),
      );
    vi.mocked(notesApi.assign).mockReset().mockResolvedValue(created());
    vi.mocked(notesApi.remove).mockReset().mockResolvedValue(undefined);
    vi.mocked(membersApi.list)
      .mockReset()
      .mockResolvedValue([
        {
          id: 'm1',
          userId: 'u-anna',
          email: 'anna@example.com',
          displayName: 'Anna Kowalski',
          role: 'EDIT',
          status: 'ACTIVE',
          invitedAt: '2026-01-01T00:00:00.000Z',
          activatedAt: '2026-01-01T00:00:00.000Z',
        },
      ]);
  });

  it('focuses the title and creates nothing until the first keystroke', async () => {
    const { onDone } = renderCard();
    const title = screen.getByRole('textbox', { name: 'Titel der neuen Notiz' });
    expect(title).toHaveFocus();
    expect(notesApi.create).not.toHaveBeenCalled();
    await userEvent.setup().keyboard('{Escape}');
    expect(notesApi.create).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith(null, false);
  });

  it('creates the note on the first keystroke with the placement and visibility', async () => {
    renderCard();
    await userEvent
      .setup()
      .type(screen.getByRole('textbox', { name: 'Titel der neuen Notiz' }), 'M');
    await waitFor(() => expect(notesApi.create).toHaveBeenCalledTimes(1));
    expect(vi.mocked(notesApi.create).mock.calls[0]![1]).toMatchObject({
      title: 'M',
      freeX: 10,
      freeY: 20,
      visibility: 'SHARED',
    });
  });

  it('commits on Enter with the title and the kept chips, then reports the note', async () => {
    const { onDone } = renderCard();
    const user = userEvent.setup();
    await user.type(
      screen.getByRole('textbox', { name: 'Titel der neuen Notiz' }),
      'Müller anrufen Freitag @anna dringend',
    );
    expect(screen.getByRole('button', { name: /Fällig/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zuständig: Anna Kowalski' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Priorität hoch' })).toBeInTheDocument();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('n-new', false));
    const update = vi.mocked(notesApi.update).mock.calls.at(-1)!;
    expect(update[0]).toBe('n-new');
    expect(update[1]).toMatchObject({
      title: 'Müller anrufen Freitag @anna dringend',
      priority: 'HOCH',
    });
    expect((update[1] as { dueDate?: string }).dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(notesApi.assign).toHaveBeenCalledWith('n-new', 'u-anna', expect.anything());
  });

  it('removing a chip keeps that field out of the commit', async () => {
    renderCard();
    const user = userEvent.setup();
    await user.type(
      screen.getByRole('textbox', { name: 'Titel der neuen Notiz' }),
      'Müller anrufen Freitag @anna',
    );
    await user.click(
      screen
        .getByRole('button', { name: 'Vorschlag entfernen', hidden: false, exact: false })
        .closest('[data-chip="assignee"]')!
        .querySelector('button[aria-label="Vorschlag entfernen"]')!,
    );
    await user.keyboard('{Enter}');
    await waitFor(() => expect(notesApi.update).toHaveBeenCalled());
    expect(notesApi.assign).not.toHaveBeenCalled();
    expect(vi.mocked(notesApi.update).mock.calls.at(-1)![1]).not.toHaveProperty('assigneeId');
  });

  it('Shift+Enter opens the text line, Enter from there commits with the description', async () => {
    renderCard();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Titel der neuen Notiz' }), 'Angebot');
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    const text = await screen.findByRole('textbox', { name: 'Text der neuen Notiz' });
    expect(text).toHaveFocus();
    await user.type(text, 'drei Varianten{Enter}');
    await waitFor(() => expect(notesApi.update).toHaveBeenCalled());
    expect(vi.mocked(notesApi.update).mock.calls.at(-1)![1]).toMatchObject({
      title: 'Angebot',
      description: 'drei Varianten',
    });
  });

  it('does not commit a whitespace title on Enter and deletes the note on blur', async () => {
    const { onDone } = renderCard();
    const user = userEvent.setup();
    const title = screen.getByRole('textbox', { name: 'Titel der neuen Notiz' });
    await user.type(title, 'a{Backspace} ');
    await user.keyboard('{Enter}');
    expect(onDone).not.toHaveBeenCalled();
    expect(title).toBeInTheDocument();
    await user.tab();
    await waitFor(() => expect(notesApi.remove).toHaveBeenCalledWith('n-new', expect.anything()));
    expect(onDone).toHaveBeenCalledWith(null, false);
  });

  it('Esc after typing deletes the note; Cmd+Enter commits and asks to open', async () => {
    const first = renderCard();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Titel der neuen Notiz' }), 'Weg');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(notesApi.remove).toHaveBeenCalled());
    expect(first.onDone).toHaveBeenCalledWith(null, false);
  });

  it('commits with Cmd+Enter and asks to open the note', async () => {
    const { onDone } = renderCard();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Titel der neuen Notiz' }), 'Details');
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('n-new', true));
  });

  it('underlines the matched words in the field', async () => {
    renderCard();
    await userEvent
      .setup()
      .type(
        screen.getByRole('textbox', { name: 'Titel der neuen Notiz' }),
        'Müller anrufen Freitag',
      );
    const marks = screen.getAllByTestId('capture-mark');
    expect(marks.map((m) => m.textContent)).toEqual(['Freitag']);
  });

  it('renders as a full-width row in the list layout', () => {
    renderCard('row');
    expect(screen.getByRole('group', { name: 'Neue Notiz schreiben' })).toHaveAttribute(
      'data-layout',
      'row',
    );
  });
});
```

The chip-removal test may need its selector simplified to `within(chip).getByRole('button', { name: 'Vorschlag entfernen' })` using `data-chip="assignee"` on the chip's wrapper; keep the behaviour it asserts.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/mr_user/development/apps/wally-capture/apps/web && pnpm vitest run src/features/board/Capture/InlineCaptureCard.test.tsx`
Expected: FAIL, cannot find module `./InlineCaptureCard`.

- [ ] **Step 3: The copy and the keyframe**

Add the `capture` block to `de.ts` (after `note`) and its English mirror to `en.ts`. In `apps/web/tailwind.config.ts`, add to `theme.extend.keyframes`:

```ts
        'capture-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
```

and to `theme.extend.animation`: `'capture-in': 'capture-in 150ms cubic-bezier(0.2, 0.7, 0.2, 1) both'`. The `NoteCard` guard test checks only that no `note-in` animation exists; this one is for the capture card, which is never a dragged card.

- [ ] **Step 4: The controller**

Create `apps/web/src/features/board/Capture/useCapture.ts`:

```ts
import { useCallback, useRef, useState } from 'react';
import type { NoteCreateInput, NoteDto, NoteVisibility } from '@wally/shared';
import { useAssignNote } from '../hooks/mutations/useAssignNote';
import { useCreateNote } from '../hooks/mutations/useCreateNote';
import { useDeleteNote } from '../hooks/mutations/useDeleteNote';
import { useUpdateNote } from '../hooks/mutations/useUpdateNote';

export type CapturePlacement =
  | { kind: 'free'; x: number; y: number }
  | {
      kind: 'zone';
      axis: 'horizon' | 'priority';
      key: string;
      at: { freeX: number; freeY: number };
    }
  | { kind: 'list' };

export interface CaptureFields {
  dueDate: string | null;
  assigneeId: string | null;
  priority: 'HOCH' | 'NIEDRIG' | null;
}

export interface CaptureController {
  state: 'drafting' | 'creating' | 'committing';
  noteId: string | null;
  onFirstKeystroke: (title: string) => void;
  commit: (
    draft: { title: string; description: string; fields: CaptureFields },
    thenOpen: boolean,
  ) => Promise<void>;
  cancel: () => Promise<void>;
}

function placementInput(placement: CapturePlacement): Partial<NoteCreateInput> {
  switch (placement.kind) {
    case 'free':
      return { freeX: placement.x, freeY: placement.y };
    case 'zone':
      return placement.axis === 'horizon'
        ? { ...placement.at, horizon: placement.key as NoteCreateInput['horizon'] }
        : { ...placement.at, priority: placement.key as NoteCreateInput['priority'] };
    case 'list':
      return {};
  }
}

/**
 * The state machine behind the capture card (WALLYBOT_INLINE.md §3.1): the note exists from
 * the first keystroke, so nothing typed is lost; the commit is one update plus, when a person
 * chip was kept, one assignment; cancelling after typing deletes the note the person chose to
 * abandon. Creation and update go through the existing optimistic hooks and the mutation lane.
 */
export function useCapture(
  boardId: string,
  placement: CapturePlacement,
  visibility: NoteVisibility,
  callbacks: { onDone: (noteId: string | null, open: boolean) => void },
): CaptureController {
  const createNote = useCreateNote(boardId);
  const updateNote = useUpdateNote(boardId);
  const assignNote = useAssignNote(boardId);
  const deleteNote = useDeleteNote(boardId);
  const [state, setState] = useState<CaptureController['state']>('drafting');
  const [noteId, setNoteId] = useState<string | null>(null);
  // The create's promise, so a commit or cancel that lands before the id is known can wait.
  const creation = useRef<Promise<NoteDto> | null>(null);

  const onFirstKeystroke = useCallback(
    (title: string) => {
      if (creation.current) return;
      setState('creating');
      creation.current = createNote.mutateAsync({
        ...placementInput(placement),
        title,
        visibility,
      });
      creation.current.then(
        (note) => {
          setNoteId(note.id);
          setState('drafting');
        },
        () => {
          creation.current = null;
          setState('drafting');
        },
      );
    },
    [createNote, placement, visibility],
  );

  const commit = useCallback<CaptureController['commit']>(
    async ({ title, description, fields }, thenOpen) => {
      setState('committing');
      try {
        const note = creation.current ? await creation.current : null;
        const id = note?.id ?? noteId;
        if (!id) {
          // No keystroke ever happened; nothing to save.
          callbacks.onDone(null, false);
          return;
        }
        await updateNote.mutateAsync({
          noteId: id,
          input: {
            title,
            description,
            ...(fields.dueDate ? { dueDate: fields.dueDate } : {}),
            ...(fields.priority ? { priority: fields.priority } : {}),
          },
        });
        if (fields.assigneeId)
          await assignNote.mutateAsync({ noteId: id, assigneeId: fields.assigneeId });
        callbacks.onDone(id, thenOpen);
      } finally {
        setState('drafting');
      }
    },
    [assignNote, callbacks, noteId, updateNote],
  );

  const cancel = useCallback(async () => {
    const note = creation.current ? await creation.current.catch(() => null) : null;
    const id = note?.id ?? noteId;
    if (id) deleteNote.deleteNote?.(id);
    callbacks.onDone(null, false);
  }, [callbacks, deleteNote, noteId]);

  return { state, noteId, onFirstKeystroke, commit, cancel };
}
```

Read `useDeleteNote.ts`, `useUpdateNote.ts` and `useAssignNote.ts` first and call them exactly as they expose themselves: `useDeleteNote` returns a function that captures its own ticket and shows the Undo toast (check its return shape and whether `mutateAsync` or a wrapper is the right call; the draft's `deleteNote.deleteNote?.(id)` is a placeholder for whatever its API is, and `useUpdateNote` validates `input` against `NoteUpdateInput`, whose `priority` is applied through `fieldChanges`/plain fields as the schema allows; check `noteUpdateSchema` in `packages/shared/src/schemas/note.ts` for the exact field name of a priority change and use that). A deleted capture note should not show the board's Undo toast; if `useDeleteNote` always toasts, call `notesApi.remove` through the mutation lane with `captureMutation` directly and say so in the report.

- [ ] **Step 5: The chips and the card**

Create `apps/web/src/features/board/Capture/CaptureChips.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { CaptureParse } from '@/lib/capture/parseCapture';

export type ChipKind = 'dueDate' | 'assignee' | 'priority';
export interface ChipState {
  kept: Record<ChipKind, boolean>;
  dropped: Record<ChipKind, boolean>;
}

/**
 * The parser's proposals under the title: date, person, priority. Default kept; a tap toggles,
 * `×` drops for this capture. Same type and colour as the note; the due date's text carries the
 * status colour the card would show. Nothing here writes anything.
 */
export function CaptureChips({
  parse,
  memberName,
  dateLabel,
  state,
  onToggle,
  onDrop,
}: {
  parse: CaptureParse;
  memberName: string | null;
  dateLabel: string | null;
  state: ChipState;
  onToggle: (kind: ChipKind) => void;
  onDrop: (kind: ChipKind) => void;
}) {
  const { t } = useTranslation();
  const chips: { kind: ChipKind; label: string }[] = [];
  if (parse.dueDate && dateLabel && !state.dropped.dueDate)
    chips.push({ kind: 'dueDate', label: t('capture.chips.due', { date: dateLabel }) });
  if (parse.assignee && memberName && !state.dropped.assignee)
    chips.push({ kind: 'assignee', label: t('capture.chips.assignee', { name: memberName }) });
  if (parse.priority && !state.dropped.priority)
    chips.push({
      kind: 'priority',
      label: t(
        parse.priority.value === 'HOCH'
          ? 'capture.chips.priorityHigh'
          : 'capture.chips.priorityLow',
      ),
    });
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5" onMouseDown={(e) => e.preventDefault()}>
      {chips.map(({ kind, label }) => (
        <span
          key={kind}
          data-chip={kind}
          className={cn(
            'inline-flex h-6 items-center gap-1 rounded-[4px] border border-border bg-surface-alt pl-1.5 pr-0.5 text-12 leading-5 text-fg-2',
            !state.kept[kind] && 'opacity-50 line-through decoration-fg-faint',
          )}
        >
          <button
            type="button"
            onClick={() => onToggle(kind)}
            aria-pressed={state.kept[kind]}
            aria-label={label}
            className="rounded-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)]"
          >
            {label}
          </button>
          <button
            type="button"
            onClick={() => onDrop(kind)}
            aria-label={t('capture.chips.drop')}
            className="flex h-5 w-5 items-center justify-center rounded-[3px] text-fg-3 hover:bg-inset hover:text-fg-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)]"
          >
            <X className="h-3 w-3" strokeWidth={2} />
          </button>
        </span>
      ))}
    </div>
  );
}
```

`onMouseDown` prevents the field from blurring when a chip is clicked, so a click on a chip never commits the capture.

Create `apps/web/src/features/board/Capture/InlineCaptureCard.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { NoteVisibility } from '@wally/shared';
import { useLanguage } from '@/i18n/LanguageProvider';
import { cn } from '@/lib/cn';
import { parseCapture, type CaptureParse } from '@/lib/capture/parseCapture';
import { useActiveMembers } from '../hooks/useMembers';
import { noteColourFillClass } from '../util/noteDerived';
import { CaptureChips, type ChipKind, type ChipState } from './CaptureChips';
import { useCapture, type CapturePlacement } from './useCapture';

const ALL_KEPT: ChipState = {
  kept: { dueDate: true, assignee: true, priority: true },
  dropped: { dueDate: false, assignee: false, priority: false },
};

/** The field and its mirror: the textarea draws the caret and takes input; the div behind it draws the same text with the matches underlined. */
function MirroredField({
  value,
  parse,
  ...props
}: {
  value: string;
  parse: CaptureParse | null;
} & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const matches = parse
    ? [parse.dueDate, parse.assignee, parse.priority]
        .filter((m): m is NonNullable<typeof m> => m !== null)
        .sort((a, b) => a.start - b.start)
    : [];
  const pieces: { text: string; mark: boolean }[] = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.start < cursor) continue;
    if (m.start > cursor) pieces.push({ text: value.slice(cursor, m.start), mark: false });
    pieces.push({ text: value.slice(m.start, m.end), mark: true });
    cursor = m.end;
  }
  if (cursor < value.length) pieces.push({ text: value.slice(cursor), mark: false });
  const shared = 'whitespace-pre-wrap break-words text-14 font-medium leading-snug';
  return (
    <div className="relative">
      <div aria-hidden className={cn(shared, 'pointer-events-none absolute inset-0 text-fg-1')}>
        {pieces.map((p, i) =>
          p.mark ? (
            <span
              key={i}
              data-testid="capture-mark"
              className="underline decoration-fg-3 decoration-dotted underline-offset-2"
            >
              {p.text}
            </span>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
        {value.endsWith('\n') && <br />}
      </div>
      <textarea
        {...props}
        value={value}
        rows={1}
        className={cn(
          shared,
          'relative block w-full resize-none bg-transparent text-transparent caret-fg-1 outline-none placeholder:text-fg-faint',
        )}
      />
    </div>
  );
}

export function InlineCaptureCard({
  boardId,
  placement,
  visibility,
  layout,
  onDone,
}: {
  boardId: string;
  placement: CapturePlacement;
  visibility: NoteVisibility;
  layout: 'card' | 'row';
  onDone: (noteId: string | null, open: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const { language } = useLanguage();
  const { activeMembers } = useActiveMembers(boardId);
  const controller = useCapture(boardId, placement, visibility, { onDone });
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [showText, setShowText] = useState(false);
  const [chips, setChips] = useState<ChipState>(ALL_KEPT);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const settling = useRef(false);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const members = useMemo(
    () =>
      activeMembers.flatMap((m) =>
        m.userId ? [{ id: m.userId, displayName: m.displayName, email: m.email }] : [],
      ),
    [activeMembers],
  );
  const parse = useMemo(
    () => (title ? parseCapture(title, { language, today: new Date(), members }) : null),
    [title, language, members],
  );
  const memberName = parse?.assignee
    ? (activeMembers.find((m) => m.userId === parse.assignee!.memberId)?.displayName ?? null)
    : null;
  const dateLabel = parse?.dueDate
    ? new Intl.DateTimeFormat(i18n.language, {
        weekday: 'short',
        day: '2-digit',
        month: '2-digit',
      }).format(new Date(parse.dueDate.iso + 'T12:00:00'))
    : null;

  function fields() {
    return {
      dueDate:
        parse?.dueDate && chips.kept.dueDate && !chips.dropped.dueDate ? parse.dueDate.iso : null,
      assigneeId:
        parse?.assignee && chips.kept.assignee && !chips.dropped.assignee
          ? parse.assignee.memberId
          : null,
      priority:
        parse?.priority && chips.kept.priority && !chips.dropped.priority
          ? parse.priority.value
          : null,
    };
  }
  async function commit(thenOpen: boolean) {
    const trimmed = title.trim();
    if (!trimmed || settling.current) return;
    settling.current = true;
    await controller.commit(
      { title: trimmed, description: description.trim(), fields: fields() },
      thenOpen,
    );
  }
  async function cancel() {
    if (settling.current) return;
    settling.current = true;
    await controller.cancel();
  }
  function onTitleChange(next: string) {
    if (!title && next) controller.onFirstKeystroke(next);
    setTitle(next);
  }
  function onTitleKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault();
      setShowText(true);
      requestAnimationFrame(() => textRef.current?.focus());
    } else if (event.key === 'Enter') {
      event.preventDefault();
      void commit(event.metaKey || event.ctrlKey);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      void cancel();
    }
  }
  function onTextKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void commit(event.metaKey || event.ctrlKey);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      void cancel();
    }
  }
  function onBlur(event: React.FocusEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    if (title.trim()) void commit(false);
    else void cancel();
  }
  const toggle = (kind: ChipKind) =>
    setChips((s) => ({ ...s, kept: { ...s.kept, [kind]: !s.kept[kind] } }));
  const drop = (kind: ChipKind) =>
    setChips((s) => ({ ...s, dropped: { ...s.dropped, [kind]: true } }));

  return (
    <div
      role="group"
      aria-label={t('capture.cardAria')}
      data-layout={layout}
      onBlur={onBlur}
      className={cn(
        'relative flex flex-col gap-2 rounded-lg border border-[color:var(--note-border)] p-3 text-left shadow-e2',
        'ring-2 ring-inset ring-[color:var(--note-selected)]',
        'animate-capture-in motion-reduce:animate-none',
        noteColourFillClass.WEISS,
        layout === 'card' ? 'w-[248px]' : 'w-full',
      )}
    >
      <MirroredField
        ref={titleRef}
        value={title}
        parse={parse}
        onChange={(e) => onTitleChange(e.target.value)}
        onKeyDown={onTitleKey}
        aria-label={t('capture.titleAria')}
        placeholder={t('note.titlePlaceholder')}
        disabled={controller.state === 'committing'}
      />
      {showText && (
        <textarea
          ref={textRef}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={onTextKey}
          rows={2}
          aria-label={t('capture.descriptionAria')}
          placeholder={t('note.descriptionPlaceholder')}
          className="block w-full resize-none bg-transparent text-12 leading-snug text-fg-meta-on-note outline-none placeholder:text-fg-faint"
        />
      )}
      {parse && (
        <CaptureChips
          parse={parse}
          memberName={memberName}
          dateLabel={dateLabel}
          state={chips}
          onToggle={toggle}
          onDrop={drop}
        />
      )}
      <p className="text-12 text-fg-faint [@media(pointer:coarse)]:hidden">{t('capture.hint')}</p>
      <p className="hidden text-12 text-fg-faint [@media(pointer:coarse)]:block">
        {t('capture.hintCoarse')}
      </p>
    </div>
  );
}
```

`MirroredField` must forward its ref (`forwardRef`) so `titleRef` reaches the textarea; the draft omits that for brevity. Auto-grow both textareas to their content (set `style.height` from `scrollHeight` in an effect) so the card expands in place, as the design shows. A tap on a chip must not blur the field: `CaptureChips` prevents the default on `mousedown` for that reason; the blur handler also ignores focus moving inside the card.

- [ ] **Step 6: Run the tests to verify they pass**

Run the command from Step 2. Expected: PASS. Then the guard tests one at a time: `src/i18n/resources.test.ts`, `src/i18n/noHardcodedCopy.test.ts`, `src/brandGuards.test.ts`, `src/i18n/englishSurface.test.tsx`, `src/features/board/WandView/NoteCard.test.tsx` → PASS.

- [ ] **Step 7: Checks and commit**

Run from the worktree root: `pnpm --filter @wally/web typecheck && pnpm --filter @wally/web lint && pnpm format:check`. Expected: pass.

```bash
cd /Users/mr_user/development/apps/wally-capture && git add apps/web/src/i18n/de.ts apps/web/src/i18n/en.ts apps/web/tailwind.config.ts apps/web/src/features/board/Capture && git -c core.hooksPath=/dev/null commit -m "feat(web): inline capture card with parsed chips, written where the note will live" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Every creation path starts a capture

**Files:**

- Modify: `apps/web/src/features/board/AppShell.tsx` (capture state, `startCapture`, pass-through)
- Modify: `apps/web/src/features/board/WandView/WandView.tsx`, `WandCanvas.tsx`, `ZoneBands.tsx` (render the capture card at its placement; creation handlers start a capture)
- Modify: `apps/web/src/features/board/ListView/ListView.tsx` (capture row at the top; empty state shows it too)
- Modify: `apps/web/src/features/board/TopBar.tsx`, `BoardCommands.tsx` (New note and `N` start a capture)
- Modify: `docs/SPEC.md` (one sentence under notes: a note is written in place; the panel is the detail layer)
- Test: `apps/web/src/features/board/WandView/WandCanvas.test.tsx` (new), `apps/web/src/features/board/ListView/ListView.test.tsx` (one case), `apps/web/src/features/board/BoardCommands.test.tsx` (one case)

**Interfaces:**

- Consumes: `InlineCaptureCard`, `CapturePlacement` (Task 2).
- Produces: in `AppShell`, `const [capture, setCapture] = useState<CapturePlacement | null>(null)`; `startCapture(placement)` which closes an open note (`viewState.openNote(null)`) and an open question panel if present, then sets the placement; `finishCapture(noteId, open)` which clears the placement and, when `open`, calls `viewState.openNote(noteId)`. Props: `WandView` gets `capture` and `onCapture(placement)` and `onCaptureDone`; `WandCanvas` gets `capture: { x, y } | null` and renders `<InlineCaptureCard layout="card" placement={{kind:'free',...}} … style absolute at x,y>` inside the canvas; `ZoneBands` gets the zone capture and renders the card at the top of that zone's column; `ListView` gets `capture: boolean` and renders the row above the groups (and instead of the empty state when the board is empty); `TopBar.onNewNote` and `BoardCommands.onNewNote` keep their names but now start a capture (list placement below desktop or in list view, free placement at `nextFreeNotePosition` on the free canvas, zone placement in the first zone of the current axis otherwise).

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/features/board/WandView/WandCanvas.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { renderWithProviders } from '@/test/renderWithProviders';
import { WandCanvas } from './WandCanvas';

vi.mock('../Capture/InlineCaptureCard', () => ({
  InlineCaptureCard: ({ placement }: { placement: { kind: string; x?: number; y?: number } }) => (
    <div data-testid="capture" data-x={placement.x} data-y={placement.y} />
  ),
}));

describe('WandCanvas capture', () => {
  it('asks for a capture at the double-click point and renders it there', () => {
    const onCapture = vi.fn();
    renderWithProviders(
      <DndContext>
        <WandCanvas
          notes={[]}
          filtered={false}
          currentUserId="u1"
          selectedNoteId={null}
          onOpenNote={vi.fn()}
          onCapture={onCapture}
          capture={null}
          onCaptureDone={vi.fn()}
          visibility="SHARED"
          boardId="b1"
          canEditShared
          activeDragId={null}
        />
      </DndContext>,
    );
    const surface = screen.getByTestId('wand-canvas');
    fireEvent.doubleClick(surface, { clientX: 300, clientY: 200 });
    expect(onCapture).toHaveBeenCalledWith(expect.objectContaining({ kind: 'free' }));
  });
  it('renders the capture card at its placement', () => {
    renderWithProviders(
      <DndContext>
        <WandCanvas
          notes={[]}
          filtered={false}
          currentUserId="u1"
          selectedNoteId={null}
          onOpenNote={vi.fn()}
          onCapture={vi.fn()}
          capture={{ kind: 'free', x: 120, y: 80 }}
          onCaptureDone={vi.fn()}
          visibility="SHARED"
          boardId="b1"
          canEditShared
          activeDragId={null}
        />
      </DndContext>,
    );
    const card = screen.getByTestId('capture');
    expect(card).toHaveAttribute('data-x', '120');
    expect(card.parentElement).toHaveStyle({ position: 'absolute', left: '120px', top: '80px' });
  });
});
```

Add `data-testid="wand-canvas"` to the scroll container in `WandCanvas` (test ids are allowed; the brand guards do not cover them). In `ListView.test.tsx` add one case: with `capture` true the row group named "Neue Notiz schreiben" renders above the first group, and with an empty board it renders instead of the empty state. In `BoardCommands.test.tsx` add one case: `N` calls `onNewNote` once (it already exists as a shortcut; keep the test to pin that the key still fires after the wiring change).

- [ ] **Step 2: Run the tests to verify they fail**

`pnpm vitest run src/features/board/WandView/WandCanvas.test.tsx` → FAIL (props do not exist). `pnpm vitest run src/features/board/ListView/ListView.test.tsx` → FAIL on the new case.

- [ ] **Step 3: The shell**

In `AppShell.tsx`:

```tsx
const [capture, setCapture] = useState<CapturePlacement | null>(null);
const startCapture = useCallback(
  (placement: CapturePlacement) => {
    viewState.openNote(null);
    setCapture(placement);
  },
  [viewState],
);
const finishCapture = useCallback(
  (noteId: string | null, open: boolean) => {
    setCapture(null);
    if (noteId && open) viewState.openNote(noteId);
  },
  [viewState],
);
const newNote = useCallback(() => {
  if (effectiveView === 'list') startCapture({ kind: 'list' });
  else if (viewState.axis === 'free') {
    const at = nextFreeNotePosition(notes);
    startCapture({ kind: 'free', x: at.freeX, y: at.freeY });
  } else
    startCapture({
      kind: 'zone',
      axis: viewState.axis,
      key: firstZoneKey(viewState.axis),
      at: nextFreeNotePosition(notes),
    });
}, [effectiveView, notes, startCapture, viewState.axis]);
```

`firstZoneKey` returns `'HEUTE'` for the horizon axis and `'HOCH'` for priority (the first zone shown; check `groupByAxis` / `ZoneBands` for the order and use the same constant). Remove the old `createNote`-then-`openNote` body. Pass `capture`, `onCapture={startCapture}`, `onCaptureDone={finishCapture}` and `visibility={access.newNoteVisibility}` to `WandView` and `ListView`.

- [ ] **Step 4: The wall**

In `WandView.tsx`: replace `handleCreateInZone` and `handleCreateAt` bodies with `onCapture({ kind: 'zone', axis, key, at: nextFreeNotePosition(notes) })` and `onCapture({ kind: 'free', x, y })`; pass `capture`, `onCaptureDone`, `visibility`, `boardId` down to `WandCanvas` and `ZoneBands`. In `WandCanvas.tsx`, inside the canvas div after the notes:

```tsx
{
  capture?.kind === 'free' && (
    <div style={{ position: 'absolute', left: capture.x, top: capture.y, zIndex: 30 }}>
      <InlineCaptureCard
        boardId={boardId}
        placement={capture}
        visibility={visibility}
        layout="card"
        onDone={onCaptureDone}
      />
    </div>
  );
}
```

In `ZoneBands.tsx`, render the same card (layout `card`) at the top of the zone whose key matches `capture.key` when `capture?.kind === 'zone'`. The double-click handler in `WandCanvas` keeps its clamping and calls `onCapture` instead of `onCreateAt`; remove `onCreateAt`.

- [ ] **Step 5: The list, the top bar, the palette, the spec**

In `ListView.tsx`: accept `capture: boolean`, `boardId`, `visibility`, `onCaptureDone`; when `capture` is true render `<InlineCaptureCard layout="row" placement={{ kind: 'list' }} … />` inside a `rounded-lg border border-border bg-surface shadow-e1` box as the first child of the column, and, when the board is empty, render that box alone instead of the empty state. `TopBar` and `BoardCommands` keep calling `onNewNote`; nothing changes there except that the capture now opens instead of the sidebar. In `docs/SPEC.md`, under the notes section that says "Users can create a new note from the whiteboard", add: "A note is written where it will live: title and text directly on the wall or at the top of the list, created on the first keystroke; the note panel is the optional detail layer (`rfcs/WALLYBOT_INLINE.md` §3.1)."

- [ ] **Step 6: Run the tests**

One at a time: `WandCanvas.test.tsx`, `ListView.test.tsx`, `BoardCommands.test.tsx`, `NoteCard.test.tsx`, `src/features/board/Capture/InlineCaptureCard.test.tsx`, then the four i18n/brand guards. Expected: PASS. Then the whole web suite once: `pnpm vitest run` → PASS.

- [ ] **Step 7: Checks and commit**

Run from the worktree root: `pnpm --filter @wally/web typecheck && pnpm --filter @wally/web lint && pnpm format:check`. Expected: pass.

```bash
cd /Users/mr_user/development/apps/wally-capture && git add apps/web/src/features/board docs/SPEC.md && git -c core.hooksPath=/dev/null commit -m "feat(web): every way of creating a note writes it in place" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review

- **Spec coverage.** §3.1: entry points (`N`, New note, double-click, zone plus) start a capture (Task 3); typing is the note, created on the first keystroke (Task 2); Enter commits, Shift+Enter the text line, Esc discards, blur commits (Task 2); the sidebar only on a click or `⌘↵` (Tasks 2 and 3); the card grows in 150 ms (Task 2 keyframe); list row and phone (Task 3). §3.2: dates, people, urgency recognised while typing, underlined, chips, tap keeps, `×` drops, nothing applied before Enter (Tasks 1 and 2); pure and synchronous (Task 1). §7 don'ts: no modal, no focus theft (the card takes focus only when the person asked for a note), the title never rewritten.
- **Placeholder scan.** Each step has its code or exact command. Task 2 Step 4 names the three hooks whose exact call shapes the implementer verifies and the one fallback (direct `notesApi.remove` through the lane) if the delete hook always toasts.
- **Type consistency.** `CapturePlacement`, `CaptureFields`, `CaptureController` (Task 2) are the names Task 3 uses; `CaptureParse` and `CaptureMember` (Task 1) are what `InlineCaptureCard` and `CaptureChips` consume; `onDone(noteId | null, open)` has the same shape in the hook, the card, and `finishCapture`.
- **Review Focus.** 1: Task 2 first and sixth tests. 2: Task 1 "together" test and Task 2 commit and chip-removal tests. 3: Task 2 whitespace test. 4: Task 3 canvas test (the zone half is reviewed in the diff; `ZoneBands` has no harness today). 5: Task 2 `⌘↵` test and the shell's `finishCapture` reviewed in the diff.
