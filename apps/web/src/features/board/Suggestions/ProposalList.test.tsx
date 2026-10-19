import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { makeNote, makeSuggestionMark } from '@/test/fixtures';
import type { SuggestionMark } from './useSuggestions';
import type { PendingProps } from './pendingProps';
import { ProposalList } from './ProposalList';
import { i18n } from '@/i18n';
import { dueInfo } from '../util/noteDerived';
/** A date as the card's own meta line words it (Tomorrow, Fri…), which the rows reuse. */
const dueWords = (iso: string) => dueInfo({ status: 'OPEN', dueDate: iso }, i18n.t).label;

const base = makeSuggestionMark();
const note = makeNote({ dueDate: null, priority: 'MITTEL', assignee: null });
const fields = {
  ...base.suggestion!.fields,
  assignee: null,
  title: { value: 'Call the dentist', reason: 'shorter' },
  subtasks: {
    items: ['Find the number of the practice near the office', 'Book a slot'],
    reason: 'steps',
  },
  horizon: { value: 'DIESE_WOCHE' as const, reason: '"this week"' },
  visibility: { value: 'PRIVATE' as const, reason: 'a dentist visit' },
  tags: { items: ['ops', 'sales'], reason: 'board tags' },
  properties: { items: [{ key: 'Customer', value: 'Acme' }], reason: 'named' },
};
const pending = (over: Partial<SuggestionMark> = {}): PendingProps => ({
  mark: makeSuggestionMark({
    suggestion: { ...base.suggestion!, fields },
    fields: ['dueDate', 'priority', 'title', 'subtasks', 'horizon', 'tags', 'properties'],
    subtasks: [0, 1],
    tags: [0, 1],
    properties: [0],
    ...over,
  }),
  onKeep: vi.fn(),
  onDiscard: vi.fn(),
  onUndo: vi.fn(),
  onRemove: vi.fn(),
  onSetField: vi.fn(),
  onSetSubtask: vi.fn(),
  onSetLink: vi.fn(),
  onSetTag: vi.fn(),
  onSetProperty: vi.fn(),
  onPause: vi.fn(),
});

describe('ProposalList', () => {
  it('renders the title first, one row per field, then the steps as a checklist with full text', () => {
    render(<ProposalList note={note} pending={pending()} />);
    const rows = within(screen.getByRole('list', { name: 'Suggested fields' })).getAllByRole(
      'listitem',
    );
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringMatching(/^Title.*Reworded/),
      expect.stringContaining(`Due${dueWords('2026-10-23')}`),
      expect.stringMatching(/^When.*This week/),
      expect.stringMatching(/^Priority.*High/),
      expect.stringMatching(/^Private/),
      expect.stringMatching(/^Customer.*Acme/),
      expect.stringMatching(/^Tag.*ops/),
      expect.stringMatching(/^Tag.*sales/),
    ]);
    const steps = within(screen.getByRole('list', { name: 'Suggested steps' })).getAllByRole(
      'listitem',
    );
    expect(steps.map((step) => step.textContent)).toEqual([
      'Find the number of the practice near the office',
      'Book a slot',
    ]);
  });

  it('shows a typed field as a row with no button', () => {
    const typedNote = makeNote({ dueDate: '2026-10-20', priority: 'MITTEL', assignee: null });
    render(
      <ProposalList
        note={typedNote}
        pending={pending({
          suggestion: {
            ...base.suggestion!,
            typed: ['dueDate'],
            fields: { ...fields, dueDate: null },
          },
        })}
      />,
    );
    const due = screen.getByText('Due').closest('[role="listitem"]') as HTMLElement;
    expect(due.textContent).toBe(`Due${dueWords('2026-10-20')}`);
    expect(within(due).queryByRole('button')).toBeNull();
  });

  it('a step is crossed out and brought back by its own button', () => {
    const p = pending({ subtasks: [1] });
    render(<ProposalList note={note} pending={p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Leave out: Step Book a slot' }));
    expect(p.onSetSubtask).toHaveBeenCalledWith(1, false);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Bring back: Step Find the number of the practice near the office',
      }),
    );
    expect(p.onSetSubtask).toHaveBeenCalledWith(0, true);
  });

  it('× crosses a row out and ↺ brings it back through the pending callbacks', () => {
    const p = pending({ tags: [0] });
    render(<ProposalList note={note} pending={p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Leave out: When This week' }));
    expect(p.onSetField).toHaveBeenCalledWith('horizon', false);
    fireEvent.click(screen.getByRole('button', { name: 'Leave out: Tag ops' }));
    expect(p.onSetTag).toHaveBeenCalledWith(0, false);
    const back = screen.getByRole('button', { name: 'Bring back: Tag sales' });
    // The label says what a press does; no pressed state contradicts it.
    expect(back).not.toHaveAttribute('aria-pressed');
    fireEvent.click(back);
    expect(p.onSetTag).toHaveBeenCalledWith(1, true);
    fireEvent.click(screen.getByRole('button', { name: 'Leave out: Customer Acme' }));
    expect(p.onSetProperty).toHaveBeenCalledWith(0, false);
  });

  it('Private starts crossed out, and a press takes it in', () => {
    const p = pending();
    render(<ProposalList note={note} pending={p} />);
    const row = screen.getByText('Private').closest('[role="listitem"]')!;
    expect(row).toHaveAttribute('data-out');
    fireEvent.click(within(row as HTMLElement).getByRole('button'));
    expect(p.onSetField).toHaveBeenCalledWith('visibility', true);
  });

  it('rows carry their reason as accessible description', () => {
    render(<ProposalList note={note} pending={pending()} />);
    const row = screen.getByText('This week').closest('[role="listitem"]')!;
    expect(row).toHaveAttribute('aria-description', 'Because: "this week"');
  });

  it('draws no line above the rows', () => {
    render(<ProposalList note={note} pending={pending()} />);
    expect(document.querySelector('[data-proposal-list]')?.className).not.toMatch(/border-t/);
  });

  it('a press on a row never reaches the card underneath', () => {
    const onCard = vi.fn();
    render(
      <div onClick={onCard} onKeyDown={onCard}>
        <ProposalList note={note} pending={pending()} />
      </div>,
    );
    const button = screen.getByRole('button', { name: 'Leave out: When This week' });
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(onCard).not.toHaveBeenCalled();
  });
});
