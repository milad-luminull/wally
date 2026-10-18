import { foldFieldKey } from '@wally/shared';
import type { AssistantSuggestionDoc } from '../../db/types.js';
import type { CaptureFixture, ScoredField } from './captureFixtures.js';

/** What a proposal holds, reduced to what the fixtures compare. */
export interface ScoredProposal {
  dueDate?: string;
  horizon?: string;
  priority?: string;
  assignee?: string;
  visibility?: string;
  title?: boolean;
  description?: boolean;
  subtasks?: boolean;
  tags?: string[];
  properties?: Record<string, string>;
}
export type Outcome = 'right' | 'wrong' | 'missed' | 'extra';
export interface FieldScore {
  fixture: string;
  field: ScoredField;
  outcome: Outcome;
}
export interface Summary {
  byField: Partial<Record<ScoredField, Record<Outcome, number>>>;
  scored: number;
  right: number;
  /** Ids of the anti-goal fixtures with any wrong or extra field. */
  antiGoalFailures: string[];
}

type StoredFields = AssistantSuggestionDoc['fields'];
/**
 * Reads the accepted fields of any release: a baseline's single `reference` is one property,
 * so a baseline and a later run score the same fixture the same way.
 */
export function normalizeProposal(fields: StoredFields | null): ScoredProposal {
  if (!fields) return {};
  // Read loosely: the fields this release does not know yet are simply absent.
  const f = fields as StoredFields & {
    horizon?: { value: string } | null;
    visibility?: { value: string } | null;
    description?: { value: string } | null;
    tags?: { items: string[] } | null;
    properties?: { items: { key: string; value: string }[] } | null;
  };
  const out: ScoredProposal = {};
  if (f.dueDate) out.dueDate = f.dueDate.value;
  if (f.horizon) out.horizon = f.horizon.value;
  if (f.priority) out.priority = f.priority.value;
  if (f.assignee) out.assignee = f.assignee.value;
  if (f.visibility) out.visibility = f.visibility.value;
  if (f.title) out.title = true;
  if (f.description) out.description = true;
  if (f.subtasks) out.subtasks = true;
  if (f.tags?.items.length) out.tags = f.tags.items;
  const properties = [
    ...(f.properties?.items ?? []),
    ...(f.reference ? [{ key: f.reference.key, value: f.reference.value }] : []),
  ];
  if (properties.length)
    out.properties = Object.fromEntries(properties.map((p) => [p.key, p.value]));
  return out;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function scoreField(field: ScoredField, expected: unknown, proposal: ScoredProposal): Outcome {
  if (field === 'leaks') {
    const seen = [
      ...(proposal.tags ?? []),
      ...Object.entries(proposal.properties ?? {}).flat(),
    ].map((text) => text.toLowerCase());
    const markers = (expected as string[]).map((m) => m.toLowerCase());
    return markers.some((m) => seen.some((text) => text.includes(m))) ? 'extra' : 'right';
  }
  const got = proposal[field as keyof ScoredProposal];
  if (expected === null) return got === undefined ? 'right' : 'extra';
  if (got === undefined) return 'missed';
  if (expected === 'any') return 'right';
  if (field === 'tags') {
    const acceptable = expected as string[];
    return (got as string[]).every((tag) => acceptable.some((ok) => same(ok, tag)))
      ? 'right'
      : 'wrong';
  }
  if (field === 'properties') {
    const want = Object.entries(expected as Record<string, string>);
    const have = Object.entries(got as Record<string, string>);
    const matches = (k: string, v: string) =>
      have.some(([hk, hv]) => foldFieldKey(hk) === foldFieldKey(k) && same(hv, v));
    return have.length === want.length && want.every(([k, v]) => matches(k, v)) ? 'right' : 'wrong';
  }
  return got === expected ? 'right' : 'wrong';
}

/** One score per field the fixture names, in the order it names them. */
export function scoreFixture(fixture: CaptureFixture, proposal: ScoredProposal): FieldScore[] {
  return (Object.entries(fixture.expect) as [ScoredField, unknown][]).map(([field, expected]) => ({
    fixture: fixture.id,
    field,
    outcome: scoreField(field, expected, proposal),
  }));
}

export function summarize(runs: { fixture: CaptureFixture; scores: FieldScore[] }[]): Summary {
  const summary: Summary = { byField: {}, scored: 0, right: 0, antiGoalFailures: [] };
  for (const { fixture, scores } of runs) {
    for (const { field, outcome } of scores) {
      const counts = (summary.byField[field] ??= { right: 0, wrong: 0, missed: 0, extra: 0 });
      counts[outcome] += 1;
      summary.scored += 1;
      if (outcome === 'right') summary.right += 1;
    }
    if (fixture.antiGoal && scores.some((s) => s.outcome === 'wrong' || s.outcome === 'extra'))
      summary.antiGoalFailures.push(fixture.id);
  }
  return summary;
}
