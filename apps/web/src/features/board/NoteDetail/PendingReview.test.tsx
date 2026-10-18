import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SuggestionFields } from '@wally/shared';
import { makeNote, makeSuggestionMark } from '@/test/fixtures';
import type { SuggestionMark } from '../Suggestions/useSuggestions';
import { proposedDateLabel, type PendingProps } from '../Suggestions/pendingProps';
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
    onPause: vi.fn(),
  };
  const view = render(<PendingReview note={note} pending={pending} />);
  /** The same review once the controller's mark moved on. */
  const moveTo = (next: Partial<SuggestionMark>) =>
    view.rerender(<PendingReview note={note} pending={{ ...pending, mark: markWith(next) }} />);
  return { pending, moveTo };
}

describe('PendingReview', () => {
  it('shows the typed group from the note and the record, and the added group from the proposal', () => {
    renderReview();

    const typed = screen.getByRole('group', { name: 'From what you typed' });
    const title = within(typed).getByRole('checkbox', { name: 'Title: Call Müller' });
    // The title is the note itself: it stays, and cannot be taken off here.
    expect(title).toBeChecked();
    expect(title).toBeDisabled();
    const due = within(typed).getByRole('checkbox', {
      name: `Due ${proposedDateLabel('2026-10-23', 'en')}`,
    });
    expect(due).toBeChecked();
    expect(due).toBeDisabled();
    expect(within(typed).getAllByRole('checkbox')).toHaveLength(2);

    const added = screen.getByRole('group', { name: 'Added by Wallybot' });
    // Opt-in (R2): offered, never ticked at first.
    expect(
      within(added).getByRole('checkbox', { name: 'Suggested: Call Müller GmbH back' }),
    ).not.toBeChecked();
    expect(within(added).getByRole('checkbox', { name: 'High priority' })).toBeChecked();
    expect(within(added).getByRole('checkbox', { name: 'Customer: Müller GmbH' })).toBeChecked();
    for (const step of proposal.subtasks!.items) {
      expect(within(added).getByRole('checkbox', { name: `Step: ${step}` })).toBeChecked();
    }
    expect(within(added).getAllByRole('checkbox')).toHaveLength(6);
  });

  it('keeps an unticked row in place, so it can be ticked back', () => {
    renderReview({ fields: ['priority', 'subtasks'], subtasks: [0, 2] });

    const added = screen.getByRole('group', { name: 'Added by Wallybot' });
    expect(
      within(added).getByRole('checkbox', { name: 'Customer: Müller GmbH' }),
    ).not.toBeChecked();
    expect(within(added).getByRole('checkbox', { name: 'Step: Open the quote' })).not.toBeChecked();
    expect(within(added).getByRole('checkbox', { name: 'Step: Note the call back' })).toBeChecked();
  });

  it('ticking rows reports to the controller', async () => {
    const user = userEvent.setup();
    const { pending } = renderReview();

    await user.click(screen.getByRole('checkbox', { name: 'Step: Open the quote' }));
    expect(pending.onSetSubtask).toHaveBeenCalledWith(1, false);

    await user.click(screen.getByRole('checkbox', { name: 'Suggested: Call Müller GmbH back' }));
    expect(pending.onSetField).toHaveBeenCalledWith('title', true);

    await user.click(screen.getByRole('checkbox', { name: 'Customer: Müller GmbH' }));
    expect(pending.onSetField).toHaveBeenCalledWith('reference', false);
  });

  describe('the proposed links', () => {
    const withLinks = (indexes: [number, number], links: number[]): Partial<SuggestionMark> => {
      const base = markWith();
      return {
        fields: ['priority', 'links'],
        links,
        suggestion: {
          ...base.suggestion!,
          fields: {
            ...proposal,
            links: {
              items: [
                { index: indexes[0], noteId: 'b', title: 'Supplier list', reason: 'same supplier' },
                { index: indexes[1], noteId: 'c', title: '', reason: 'same quote' },
              ],
              reason: 'related',
            },
          },
        },
      };
    };

    it('offers one row per link, ticked as the mark says, and ticking one reports its index', async () => {
      const user = userEvent.setup();
      const { pending } = renderReview(withLinks([0, 1], [0]));

      const added = screen.getByRole('group', { name: 'Added by Wallybot' });
      expect(within(added).getByRole('checkbox', { name: 'Related: Supplier list' })).toBeChecked();
      const second = within(added).getByRole('checkbox', { name: 'Related: Untitled' });
      expect(second).not.toBeChecked();
      await user.click(second);
      expect(pending.onSetLink).toHaveBeenCalledWith(1, true);
    });

    it('names a link by the index the proposal stored, not its place in the list', async () => {
      const user = userEvent.setup();
      // The item stored at index 1 dropped out on the server: the second row is index 2.
      const { pending } = renderReview(withLinks([0, 2], [2]));

      expect(screen.getByRole('checkbox', { name: 'Related: Supplier list' })).not.toBeChecked();
      const second = screen.getByRole('checkbox', { name: 'Related: Untitled' });
      expect(second).toBeChecked();
      await user.click(second);
      expect(pending.onSetLink).toHaveBeenCalledWith(2, false);
    });

    it('shows every link unticked once the links are out of the change', () => {
      renderReview({ ...withLinks([0, 1], [0, 1]), fields: ['priority'] });
      expect(screen.getByRole('checkbox', { name: 'Related: Supplier list' })).not.toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'Related: Untitled' })).not.toBeChecked();
    });
  });

  /*
   * R4 as ruled: the typed rows document what the person wrote. A typed value changes in the
   * panel's own fields, which ends the pending change as any edit does.
   */
  it('typed rows are checked and cannot be unticked', async () => {
    const user = userEvent.setup();
    const { pending } = renderReview();

    const typed = screen.getByRole('group', { name: 'From what you typed' });
    const rows = within(typed).getAllByRole('checkbox');
    for (const row of rows) {
      expect(row).toBeChecked();
      expect(row).toBeDisabled();
      expect(row).toHaveAttribute('aria-disabled', 'true');
    }

    const due = within(typed).getByRole('checkbox', {
      name: `Due ${proposedDateLabel('2026-10-23', 'en')}`,
    });
    await user.click(due);
    await user.click(within(typed).getByText(`Due ${proposedDateLabel('2026-10-23', 'en')}`));
    expect(due).toBeChecked();
    expect(pending.onSetField).not.toHaveBeenCalled();
    expect(pending.onSetSubtask).not.toHaveBeenCalled();
    expect(pending.onRemove).not.toHaveBeenCalled();
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
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
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
    const row = screen.getByRole('checkbox', { name: 'Customer: Müller GmbH' });
    row.focus();
    moveTo({ phase: 'kept' });
    expect(screen.getByRole('button', { name: 'Undo' })).not.toHaveFocus();
  });

  it('cannot keep a change that holds nothing but an unticked title', async () => {
    const user = userEvent.setup();
    const { pending } = renderReview({ fields: [], subtasks: [] });
    const keep = screen.getByRole('button', { name: 'Keep' });
    expect(keep).toBeDisabled();
    await user.click(keep);
    expect(pending.onKeep).not.toHaveBeenCalled();
    // Ticking the title makes it one the person can keep.
    expect(screen.getByRole('button', { name: 'Discard' })).toBeEnabled();
  });

  it("names a priority row with the card's own words, in German too", async () => {
    await i18n.changeLanguage('de');
    renderReview();
    const added = screen.getByRole('group', { name: 'Von Wallybot ergänzt' });
    expect(within(added).getByRole('checkbox', { name: 'Priorität hoch' })).toBeChecked();
  });
});
