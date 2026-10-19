import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SuggestionFields } from '@wally/shared';
import { makeNote, makeSuggestionMark } from '@/test/fixtures';
import type { SuggestionMark } from '../Suggestions/useSuggestions';
import type { PendingProps } from '../Suggestions/pendingProps';
import { i18n } from '@/i18n';
import { PendingReview } from './PendingReview';

const note = makeNote({
  title: 'Call Müller',
  dueDate: '2026-10-23',
  priority: 'MITTEL',
  customFields: {},
  subtaskSummary: { done: 0, total: 0 },
});

const proposal: SuggestionFields = {
  dueDate: null,
  priority: { value: 'HOCH', reason: 'urgent' },
  assignee: null,
  title: { value: 'Call Müller GmbH back', reason: 'clearer' },
  reference: { key: 'Customer', value: 'Müller GmbH', reason: 'Müller' },
  subtasks: {
    items: ['Look up the number', 'Open the quote', 'Note the call back'],
    reason: 'call',
  },
  links: null,
  horizon: null,
  visibility: null,
  tags: null,
  properties: null,
  description: null,
};

function markWith(over: Partial<SuggestionMark> = {}): SuggestionMark {
  const base = makeSuggestionMark();
  return {
    ...base,
    suggestion: { ...base.suggestion!, fields: proposal, typed: ['dueDate'] },
    fields: ['priority', 'reference', 'subtasks'],
    subtasks: [0, 1, 2],
    countdownEndsAt: null,
    ...over,
  };
}

function renderReview(over: Partial<SuggestionMark> = {}) {
  const pending: PendingProps = {
    mark: markWith(over),
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
  };
  const view = render(<PendingReview note={note} pending={pending} />);
  /** The same review once the controller's mark moved on. */
  const moveTo = (next: Partial<SuggestionMark>) =>
    view.rerender(<PendingReview note={note} pending={{ ...pending, mark: markWith(next) }} />);
  return { pending, moveTo };
}

describe('PendingReview', () => {
  it('lists the same rows as the card: × leaves one out, ↺ brings it back', async () => {
    const user = userEvent.setup();
    const { pending } = renderReview({ fields: ['priority', 'subtasks'] });
    const list = screen.getByRole('list', { name: 'Suggested fields' });
    expect(within(list).getByText('Reworded')).toBeInTheDocument();
    expect(within(list).getByText('Müller GmbH')).toBeInTheDocument();
    // The date the person typed is a row of its own, without a button.
    const due = within(list).getByText('Due').closest('[role="listitem"]') as HTMLElement;
    expect(within(due).queryByRole('button')).toBeNull();
    await user.click(within(list).getByRole('button', { name: 'Leave out: Priority High' }));
    expect(pending.onSetField).toHaveBeenCalledWith('priority', false);
    await user.click(
      within(list).getByRole('button', { name: 'Bring back: Customer Müller GmbH' }),
    );
    expect(pending.onSetField).toHaveBeenCalledWith('reference', true);
    const steps = screen.getByRole('list', { name: 'Suggested steps' });
    expect(within(steps).getAllByRole('listitem')).toHaveLength(3);
  });

  it('Keep, Discard and Undo', async () => {
    const user = userEvent.setup();
    const { pending } = renderReview();

    expect(screen.getByRole('status')).toHaveTextContent('Waiting for you.');
    await user.click(screen.getByRole('button', { name: 'Keep' }));
    // A click on the review's button, recorded as one (WALLYBOT_INLINE.md §4).
    expect(pending.onKeep).toHaveBeenCalledWith('click');
    expect(pending.onKeep).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(pending.onDiscard).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });

  it('says the change is applied in a moment while a countdown runs, or waits paused', () => {
    renderReview({ countdownEndsAt: Date.now() + 4000 });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Applied in a moment; it waits while this panel is open.',
    );
  });

  it('counts a countdown the open panel paused as one that runs', () => {
    renderReview({ countdownEndsAt: null, paused: true });
    expect(screen.getByRole('status')).toHaveTextContent('Applied in a moment');
  });

  it('offers only Undo once the change is kept', async () => {
    const user = userEvent.setup();
    const { pending } = renderReview({ phase: 'kept' });

    expect(screen.getByRole('status')).toHaveTextContent('Kept.');
    expect(screen.queryByRole('button', { name: 'Keep' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Discard' })).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Suggested fields' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(pending.onUndo).toHaveBeenCalledWith('click');
    expect(pending.onUndo).toHaveBeenCalledTimes(1);
  });

  it('gives Undo the focus once a keep pressed from the keyboard lands', async () => {
    const user = userEvent.setup();
    const { pending, moveTo } = renderReview();
    const keep = screen.getByRole('button', { name: 'Keep' });
    keep.focus();
    await user.keyboard('{Enter}');
    expect(pending.onKeep).toHaveBeenCalledWith('click');
    moveTo({ phase: 'kept' });
    // The same button, now Undo: the keyboard is where it was.
    expect(screen.getByRole('button', { name: 'Undo' })).toBe(keep);
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveFocus();
  });

  it('leaves focus where the person put it while the keep was on its way', async () => {
    const user = userEvent.setup();
    const { moveTo } = renderReview();
    screen.getByRole('button', { name: 'Keep' }).focus();
    await user.keyboard('{Enter}');
    const row = screen.getByRole('button', { name: 'Leave out: Priority High' });
    row.focus();
    moveTo({ phase: 'kept' });
    expect(screen.getByRole('button', { name: 'Undo' })).not.toHaveFocus();
  });

  it('Keep stays active with everything crossed out (it then discards)', async () => {
    const user = userEvent.setup();
    const { pending } = renderReview({ fields: [], subtasks: [] });
    await user.click(screen.getByRole('button', { name: 'Keep' }));
    expect(pending.onKeep).toHaveBeenCalledWith('click');
  });

  it('names the rows in German too', async () => {
    await i18n.changeLanguage('de');
    renderReview();
    const list = screen.getByRole('list', { name: 'Vorgeschlagene Felder' });
    expect(
      within(list).getByRole('button', { name: 'Weglassen: Priorität Hoch' }),
    ).toBeInTheDocument();
  });
});
