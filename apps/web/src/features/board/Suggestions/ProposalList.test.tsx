import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { makeSuggestionMark } from '@/test/fixtures';
import type { SuggestionMark } from './useSuggestions';
import type { PendingProps } from './pendingProps';
import { ProposalList } from './ProposalList';

const base = makeSuggestionMark();
const fields = {
  ...base.suggestion!.fields,
  assignee: null,
  horizon: { value: 'DIESE_WOCHE' as const, reason: '"this week"' },
  visibility: { value: 'PRIVATE' as const, reason: 'a dentist visit' },
  tags: { items: ['ops', 'sales'], reason: 'board tags' },
  properties: { items: [{ key: 'Customer', value: 'Acme' }], reason: 'named' },
};
const pending = (over: Partial<SuggestionMark> = {}): PendingProps => ({
  mark: makeSuggestionMark({
    suggestion: { ...base.suggestion!, fields },
    fields: ['dueDate', 'priority', 'horizon', 'tags', 'properties'],
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
  it('renders one row per proposed item in order', () => {
    render(<ProposalList pending={pending()} />);
    const rows = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringMatching(/^Due.*10\/23/),
      expect.stringMatching(/^When.*This week/),
      expect.stringMatching(/^Priority.*High/),
      expect.stringMatching(/^Private/),
      expect.stringMatching(/^Customer.*Acme/),
      expect.stringMatching(/^Tag.*ops/),
      expect.stringMatching(/^Tag.*sales/),
    ]);
  });

  it('× crosses a row out and ↺ brings it back through the pending callbacks', () => {
    const p = pending({ tags: [0] });
    render(<ProposalList pending={p} />);
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
    render(<ProposalList pending={p} />);
    const row = screen.getByText('Private').closest('[role="listitem"]')!;
    expect(row).toHaveAttribute('data-out');
    fireEvent.click(within(row as HTMLElement).getByRole('button'));
    expect(p.onSetField).toHaveBeenCalledWith('visibility', true);
  });

  it('rows carry their reason as accessible description', () => {
    render(<ProposalList pending={pending()} />);
    const row = screen.getByText('This week').closest('[role="listitem"]')!;
    expect(row).toHaveAttribute('aria-description', 'Because: "this week"');
  });

  it('a press on a row never reaches the card underneath', () => {
    const onCard = vi.fn();
    render(
      <div onClick={onCard} onKeyDown={onCard}>
        <ProposalList pending={pending()} />
      </div>,
    );
    const button = screen.getByRole('button', { name: 'Leave out: When This week' });
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(onCard).not.toHaveBeenCalled();
  });
});
