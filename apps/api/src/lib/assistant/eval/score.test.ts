import { describe, expect, it } from 'vitest';
import { buildCaptureCall } from '../captureProposal.js';
import {
  CAPTURE_FIXTURES,
  fixtureBoard,
  fixtureContext,
  fixtureNote,
  type CaptureFixture,
} from './captureFixtures.js';
import { normalizeProposal, scoreFixture, summarize } from './score.js';

const fixture = (overrides: Partial<CaptureFixture>): CaptureFixture => ({
  id: 'f',
  note: { title: 'A note' },
  expect: {},
  ...overrides,
});

describe('scoreFixture', () => {
  it('scores an exact field right, wrong or missed', () => {
    const f = fixture({ expect: { dueDate: '2026-10-23', priority: 'HOCH', assignee: 'u-anna' } });
    const scores = scoreFixture(f, { dueDate: '2026-10-23', priority: 'NIEDRIG' });
    expect(scores).toEqual([
      { fixture: 'f', field: 'dueDate', outcome: 'right' },
      { fixture: 'f', field: 'priority', outcome: 'wrong' },
      { fixture: 'f', field: 'assignee', outcome: 'missed' },
    ]);
  });

  it('a field expected absent is right when absent and extra when proposed', () => {
    const f = fixture({ expect: { assignee: null, visibility: null } });
    expect(scoreFixture(f, { visibility: 'PRIVATE' }).map((s) => s.outcome)).toEqual([
      'right',
      'extra',
    ]);
  });

  it("'any' scores presence for free text", () => {
    const f = fixture({ expect: { title: 'any', subtasks: 'any' } });
    expect(scoreFixture(f, { title: true }).map((s) => s.outcome)).toEqual(['right', 'missed']);
  });

  it('tags are right when every proposed tag is acceptable, ignoring case', () => {
    const f = fixture({ expect: { tags: ['sales', 'finance'] } });
    expect(scoreFixture(f, { tags: ['Sales'] })[0]!.outcome).toBe('right');
    expect(scoreFixture(f, { tags: ['sales', 'urgent'] })[0]!.outcome).toBe('wrong');
    expect(scoreFixture(f, {})[0]!.outcome).toBe('missed');
  });

  it('properties are right when every expected key holds its value and nothing else is proposed', () => {
    const f = fixture({ expect: { properties: { Customer: 'Acme', Project: 'Relaunch' } } });
    const right = { properties: { customer: 'acme', Project: 'Relaunch' } };
    expect(scoreFixture(f, right)[0]!.outcome).toBe('right');
    expect(scoreFixture(f, { properties: { Customer: 'Acme' } })[0]!.outcome).toBe('wrong');
    expect(scoreFixture(f, { properties: { ...right.properties, Region: 'EU' } })[0]!.outcome).toBe(
      'wrong',
    );
  });
});

describe('leaks', () => {
  it('is right when no listed marker appears in a tag or property, extra when one does', () => {
    const f = fixture({ expect: { leaks: ['kx-77', 'zq-4410'] } });
    expect(scoreFixture(f, { tags: ['ops'], properties: { Customer: 'Acme' } })[0]!.outcome).toBe(
      'right',
    );
    expect(scoreFixture(f, { tags: ['KX-77'] })[0]!.outcome).toBe('extra');
    expect(scoreFixture(f, { properties: { 'Ref code': 'zq-4410' } })[0]!.outcome).toBe('extra');
    expect(scoreFixture(f, {})[0]!.outcome).toBe('right');
  });
});

describe('normalizeProposal', () => {
  it('reads a baseline reference as one property', () => {
    expect(
      normalizeProposal({
        dueDate: null,
        priority: null,
        assignee: null,
        reference: { key: 'Customer', value: 'Acme', reason: 'named' },
      }),
    ).toEqual({ properties: { Customer: 'Acme' } });
  });

  it('reads nothing proposed as an empty proposal', () => {
    expect(normalizeProposal(null)).toEqual({});
  });
});

describe('summarize', () => {
  it('counts outcomes per field and one anti-goal failure per failing anti-goal fixture', () => {
    const anti = fixture({
      id: 'anti',
      antiGoal: true,
      expect: { assignee: null, visibility: null },
    });
    const plain = fixture({ id: 'plain', expect: { assignee: 'u-anna' } });
    const summary = summarize([
      { fixture: anti, scores: scoreFixture(anti, { assignee: 'u-ben', visibility: 'PRIVATE' }) },
      { fixture: plain, scores: scoreFixture(plain, { assignee: 'u-ben' }) },
    ]);
    expect(summary.byField.assignee).toEqual({ right: 0, wrong: 1, missed: 0, extra: 1 });
    expect(summary.antiGoalFailures).toEqual(['anti']);
    expect(summary.right).toBe(0);
    expect(summary.scored).toBe(3);
  });
});

describe('the fixtures', () => {
  it('hold forty uniquely named notes, each of which makes a capture call', () => {
    expect(CAPTURE_FIXTURES).toHaveLength(40);
    expect(new Set(CAPTURE_FIXTURES.map((f) => f.id)).size).toBe(40);
    for (const f of CAPTURE_FIXTURES)
      expect(
        buildCaptureCall(fixtureNote(f), fixtureBoard(f), fixtureContext(f)),
        f.id,
      ).not.toBeNull();
  });
});
