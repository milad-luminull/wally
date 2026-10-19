import type { SuggestionFieldKey } from '@wally/shared';
import type { CaptureBoardNote, CaptureContext, CaptureNote } from '../captureProposal.js';

/**
 * Sample notes for scoring the capture call (`capture-eval.ts`), each with a synthetic board
 * and what a person would expect filled in. Only the fields named in `expect` are scored: an
 * exact value, `'any'` for free text (presence is right), or `null` for "must not be
 * proposed". An `antiGoal` fixture fails as a whole on any wrong or extra field: those are
 * the spec's "fails even if it works" cases.
 *
 * Today is Monday 2026-10-19 in every fixture; the week ends on Sunday the 25th.
 */
export interface FixtureExpect {
  dueDate?: string | null;
  horizon?: 'DIESE_WOCHE' | 'SPAETER' | null;
  priority?: 'HOCH' | 'NIEDRIG' | null;
  assignee?: string | null;
  visibility?: 'PRIVATE' | null;
  title?: 'any' | null;
  description?: 'any' | null;
  subtasks?: 'any' | null;
  /** The acceptable tags: right when every proposed tag is one of them. */
  tags?: string[] | null;
  /** Every key with its value; nothing else may be proposed. */
  properties?: Record<string, string> | null;
  /**
   * Markers that exist only on the caller's private notes and that no wording could produce:
   * right when none appears in a proposed tag or property, extra (a leak) when one does.
   */
  leaks?: string[];
}
export type ScoredField = keyof FixtureExpect;

export interface CaptureFixture {
  id: string;
  antiGoal?: boolean;
  note: Partial<CaptureNote> & { title: string };
  board?: { notes?: (Partial<CaptureBoardNote> & { id: string })[] };
  locked?: SuggestionFieldKey[];
  expect: FixtureExpect;
}

export const FIXTURE_TODAY = '2026-10-19';
const ME = { id: 'u-me', email: 'me@example.com', displayName: 'Sam Me' };
const MEMBERS: CaptureContext['members'] = [
  { id: ME.id, name: 'Sam Me' },
  { id: 'u-anna', name: 'Anna Berg' },
  { id: 'u-ben', name: 'Ben Okafor' },
];

/** The board every fixture starts from: keys, values and tags a person reuses. */
const BOARD: (Partial<CaptureBoardNote> & { id: string })[] = [
  {
    id: 'b-1',
    title: 'Renewal call with Acme',
    tags: ['sales'],
    customFields: { Customer: 'Acme Corp', Project: 'Renewal 2027' },
  },
  {
    id: 'b-2',
    title: 'Q3 invoice run',
    tags: ['finance'],
    customFields: { 'Contract number': '4711' },
  },
  { id: 'b-3', title: 'Interview backend candidate', tags: ['hiring'] },
  {
    id: 'b-4',
    title: 'Server patching',
    tags: ['ops'],
    customFields: { Project: 'Infrastructure' },
  },
  {
    id: 'b-5',
    title: 'Offer for Northwind',
    tags: ['sales'],
    customFields: { Customer: 'Northwind Traders' },
  },
  // The caller's private note: none of this may reach a shared note's proposal. Its tag and
  // value are markers no wording could produce, so only a leak can bring them back.
  {
    id: 'b-6',
    title: 'Physio follow-up',
    visibility: 'PRIVATE',
    tags: ['kx-77'],
    customFields: { 'Ref code': 'zq-4410' },
  },
];

export const CAPTURE_FIXTURES: CaptureFixture[] = [
  // Dates stated or clearly implied.
  {
    id: 'date-by-friday',
    note: { title: 'Send Ben the slides by Friday' },
    expect: { dueDate: '2026-10-23', assignee: null },
  },
  {
    id: 'date-end-of-month',
    note: { title: 'Submit expense report end of month' },
    expect: { dueDate: '2026-10-31' },
  },
  {
    id: 'date-eod',
    note: { title: 'Approve the Q3 invoice run EOD' },
    expect: { dueDate: '2026-10-19', priority: 'HOCH' },
  },
  {
    id: 'date-the-3rd',
    note: { title: 'Contract 4711 renewal is due on the 3rd' },
    expect: { dueDate: '2026-11-03', properties: { 'Contract number': '4711' } },
  },
  // Vague spans go to the horizon, never to an invented date.
  {
    id: 'span-this-week',
    note: { title: 'Clean up the shared drive this week' },
    expect: { horizon: 'DIESE_WOCHE', dueDate: null },
  },
  {
    id: 'span-next-week',
    note: { title: 'Plan the team offsite next week' },
    expect: { horizon: 'SPAETER', dueDate: null },
  },
  {
    id: 'span-soon',
    note: { title: 'Look into a new CRM soon' },
    expect: { horizon: 'SPAETER', dueDate: null },
  },
  {
    id: 'span-sometime',
    note: { title: 'Sometime: reorganise the wiki' },
    expect: { horizon: 'SPAETER', priority: 'NIEDRIG', dueDate: null },
  },
  // Priority judged from stakes and timing.
  {
    id: 'prio-escalation',
    note: { title: 'Acme escalated the outage, call them back today' },
    expect: { priority: 'HOCH', properties: { Customer: 'Acme Corp' } },
  },
  {
    id: 'prio-blocker',
    note: { title: 'Fix the login bug blocking the release tomorrow' },
    expect: { priority: 'HOCH', dueDate: '2026-10-20' },
  },
  {
    id: 'prio-nice-to-have',
    note: { title: 'Nice to have: dark mode for the dashboard' },
    expect: { priority: 'NIEDRIG' },
  },
  {
    id: 'prio-when-time',
    note: { title: 'Tidy the old branches when there is time' },
    expect: { priority: 'NIEDRIG' },
  },
  // People.
  {
    id: 'person-ask',
    note: { title: 'Ask Anna to review the Northwind offer' },
    expect: { assignee: 'u-anna', properties: { Customer: 'Northwind Traders' } },
  },
  {
    id: 'person-sends',
    note: { title: 'Ben sends the patch schedule' },
    expect: { assignee: 'u-ben' },
  },
  {
    id: 'person-at',
    note: { title: '@anna draft the hiring post' },
    expect: { assignee: 'u-anna', tags: ['hiring'] },
  },
  // Clearly personal.
  {
    id: 'private-doctor',
    note: { title: 'Book a dentist appointment' },
    expect: { visibility: 'PRIVATE', assignee: null },
  },
  {
    id: 'private-salary',
    note: { title: 'Prepare my salary talk with HR' },
    expect: { visibility: 'PRIVATE' },
  },
  {
    id: 'private-gift',
    note: { title: "Buy a farewell gift for Ben's leaving party" },
    expect: { visibility: 'PRIVATE', assignee: null },
  },
  // Several properties, reusing the board's keys and spellings.
  {
    id: 'props-two',
    note: { title: 'Acme renewal 2027: send the revised terms' },
    expect: { properties: { Customer: 'Acme Corp', Project: 'Renewal 2027' }, tags: ['sales'] },
  },
  {
    id: 'props-contract',
    note: { title: 'Check invoice for contract 4711 with Northwind' },
    expect: {
      properties: { Customer: 'Northwind Traders', 'Contract number': '4711' },
      tags: ['finance', 'sales'],
    },
  },
  {
    id: 'props-infra',
    note: { title: 'Infrastructure project: order two new servers' },
    expect: { properties: { Project: 'Infrastructure' }, tags: ['ops'] },
  },
  {
    id: 'props-new-key',
    note: { title: 'Call Globex about order 88-120' },
    expect: { properties: { Customer: 'Globex', 'Order number': '88-120' } },
  },
  // Tags from the board.
  {
    id: 'tags-sales',
    note: { title: 'Follow up on the Northwind proposal' },
    expect: { tags: ['sales'] },
  },
  {
    id: 'tags-hiring',
    note: { title: 'Schedule second interview for the backend candidate' },
    expect: { tags: ['hiring'] },
  },
  { id: 'tags-ops', note: { title: 'Rotate the database credentials' }, expect: { tags: ['ops'] } },
  // Naturally multi-step tasks.
  {
    id: 'steps-board-meeting',
    note: { title: 'Prepare the board meeting' },
    expect: { subtasks: 'any' },
  },
  {
    id: 'steps-onboarding',
    note: { title: 'Onboard the new designer' },
    expect: { subtasks: 'any' },
  },
  {
    id: 'steps-move',
    note: { title: 'Move the office printer to the second floor' },
    expect: { subtasks: 'any' },
  },
  { id: 'steps-launch', note: { title: 'Launch the newsletter' }, expect: { subtasks: 'any' } },
  // Long, rambling titles: a short title and the rest as a description.
  {
    id: 'ramble-1',
    note: {
      title:
        'so Acme called and they want the new deductible options in writing before they agree and if they do we send the revised terms the same day',
    },
    expect: { title: 'any', description: 'any', properties: { Customer: 'Acme Corp' } },
  },
  {
    id: 'ramble-2',
    note: {
      title:
        'need to sort out the server patching window with Ben because last time it clashed with the invoice run and finance complained',
    },
    expect: { title: 'any', description: 'any', assignee: 'u-ben' },
  },
  {
    id: 'ramble-3',
    note: {
      title:
        'the wiki is a mess, half the onboarding pages are outdated and nobody knows which ones are current, someone should go through them',
    },
    expect: { title: 'any', description: 'any' },
  },
  // Things that need nothing but must stay clean.
  {
    id: 'plain-reply',
    note: { title: 'Reply to Anna' },
    expect: { assignee: null, subtasks: null },
  },
  {
    id: 'plain-water',
    note: { title: 'Water the office plants' },
    expect: { visibility: null, priority: null },
  },
  {
    id: 'plain-shared-work',
    note: { title: 'Update the team roadmap' },
    expect: { visibility: null },
  },
  // Anti-goals: any wrong or extra field fails the run.
  {
    id: 'anti-call-mom',
    antiGoal: true,
    note: { title: 'call mom' },
    expect: {
      assignee: null,
      subtasks: null,
      properties: null,
      tags: null,
      priority: null,
      dueDate: null,
    },
  },
  {
    id: 'anti-unknown-person',
    antiGoal: true,
    note: { title: 'Ask Priya for the venue quotes' },
    expect: { assignee: null },
  },
  {
    id: 'anti-private-tag-on-shared',
    antiGoal: true,
    note: { title: 'Book physio room for the team health day' },
    expect: { leaks: ['kx-77', 'zq-4410'] },
  },
  {
    id: 'anti-shared-filter',
    antiGoal: true,
    note: { title: 'Doctor appointment for the knee' },
    locked: ['visibility'],
    expect: { visibility: null },
  },
  {
    id: 'anti-typed-assignee',
    antiGoal: true,
    note: {
      title: 'Dentist appointment',
      assignee: { id: 'u-anna', email: 'anna@example.com', displayName: 'Anna Berg' },
    },
    expect: { visibility: null },
  },
];

/** The note a fixture describes, filled in the way a fresh capture leaves it. */
export function fixtureNote(fixture: CaptureFixture): CaptureNote {
  return {
    id: `n-${fixture.id}`,
    description: '',
    dueDate: null,
    priority: 'MITTEL',
    assignee: null,
    visibility: 'SHARED',
    horizon: 'HEUTE',
    tags: [],
    customFields: {},
    subtaskSummary: { total: 0, done: 0 },
    links: [],
    createdBy: ME,
    ...fixture.note,
  };
}

/** The board's notes as the capture reads them, newest first by id order. */
export function fixtureBoard(fixture: CaptureFixture): CaptureBoardNote[] {
  return [...BOARD, ...(fixture.board?.notes ?? [])].map((n, i) => ({
    title: '',
    status: 'OPEN',
    createdAt: new Date(Date.UTC(2026, 9, 1 + i)).toISOString(),
    visibility: 'SHARED',
    horizon: 'HEUTE',
    priority: 'MITTEL',
    tags: [],
    customFields: {},
    createdBy: ME,
    ...n,
  }));
}

export function fixtureContext(fixture: CaptureFixture): CaptureContext {
  return {
    actorId: ME.id,
    today: FIXTURE_TODAY,
    timeZone: 'Europe/Berlin',
    language: 'en',
    locked: fixture.locked ?? [],
    members: MEMBERS,
    canChangeVisibility: true,
  };
}
