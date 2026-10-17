import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SuggestionFields } from '@wally/shared';
import { makeNote, makeSuggestionMark } from '@/test/fixtures';
import type { SuggestionMark } from '../Suggestions/useSuggestions';
import { proposedDateLabel, type PendingProps } from '../Suggestions/pendingProps';
import { PendingReview } from './PendingReview';

const note = makeNote({
  title: 'Müller anrufen',
  dueDate: '2026-10-23',
  priority: 'MITTEL',
  customFields: {},
  subtaskSummary: { done: 0, total: 0 },
});

const proposal: SuggestionFields = {
  dueDate: null,
  priority: { value: 'HOCH', reason: 'dringend' },
  assignee: null,
  title: { value: 'Müller GmbH zurückrufen', reason: 'klarer' },
  reference: { key: 'Kunde', value: 'Müller GmbH', reason: 'Müller' },
  subtasks: {
    items: ['Nummer heraussuchen', 'Angebot öffnen', 'Rückruf notieren'],
    reason: 'Anruf',
  },
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
    onPause: vi.fn(),
  };
  const onTypedChange = vi.fn();
  render(<PendingReview note={note} pending={pending} onTypedChange={onTypedChange} />);
  return { pending, onTypedChange };
}

describe('PendingReview', () => {
  it('shows the typed group from the note and the record, and the added group from the proposal', () => {
    renderReview();

    const typed = screen.getByRole('group', { name: 'Aus deinem Text' });
    const title = within(typed).getByRole('checkbox', { name: 'Titel: Müller anrufen' });
    // The title is the note itself: it stays, and cannot be taken off here.
    expect(title).toBeChecked();
    expect(title).toBeDisabled();
    const due = within(typed).getByRole('checkbox', {
      name: `Fällig ${proposedDateLabel('2026-10-23', 'de')}`,
    });
    expect(due).toBeChecked();
    expect(due).toBeEnabled();
    expect(within(typed).getAllByRole('checkbox')).toHaveLength(2);

    const added = screen.getByRole('group', { name: 'Von Wallybot ergänzt' });
    // Opt-in (R2): offered, never ticked at first.
    expect(
      within(added).getByRole('checkbox', { name: 'Vorschlag: Müller GmbH zurückrufen' }),
    ).not.toBeChecked();
    expect(within(added).getByRole('checkbox', { name: 'Priorität hoch' })).toBeChecked();
    expect(within(added).getByRole('checkbox', { name: 'Kunde: Müller GmbH' })).toBeChecked();
    for (const step of proposal.subtasks!.items) {
      expect(within(added).getByRole('checkbox', { name: `Schritt: ${step}` })).toBeChecked();
    }
    expect(within(added).getAllByRole('checkbox')).toHaveLength(6);
  });

  it('keeps an unticked row in place, so it can be ticked back', () => {
    renderReview({ fields: ['priority', 'subtasks'], subtasks: [0, 2] });

    const added = screen.getByRole('group', { name: 'Von Wallybot ergänzt' });
    expect(within(added).getByRole('checkbox', { name: 'Kunde: Müller GmbH' })).not.toBeChecked();
    expect(
      within(added).getByRole('checkbox', { name: 'Schritt: Angebot öffnen' }),
    ).not.toBeChecked();
    expect(
      within(added).getByRole('checkbox', { name: 'Schritt: Rückruf notieren' }),
    ).toBeChecked();
  });

  it('ticking rows reports to the controller', async () => {
    const user = userEvent.setup();
    const { pending, onTypedChange } = renderReview();

    await user.click(screen.getByRole('checkbox', { name: 'Schritt: Angebot öffnen' }));
    expect(pending.onSetSubtask).toHaveBeenCalledWith(1, false);

    await user.click(screen.getByRole('checkbox', { name: 'Vorschlag: Müller GmbH zurückrufen' }));
    expect(pending.onSetField).toHaveBeenCalledWith('title', true);

    await user.click(screen.getByRole('checkbox', { name: 'Kunde: Müller GmbH' }));
    expect(pending.onSetField).toHaveBeenCalledWith('reference', false);

    await user.click(
      screen.getByRole('checkbox', { name: `Fällig ${proposedDateLabel('2026-10-23', 'de')}` }),
    );
    expect(onTypedChange).toHaveBeenCalledWith('dueDate', false);
  });

  it('Keep, Discard and Undo', async () => {
    const user = userEvent.setup();
    const { pending } = renderReview();

    expect(screen.getByRole('status')).toHaveTextContent('Wartet auf dich.');
    await user.click(screen.getByRole('button', { name: 'Behalten' }));
    expect(pending.onKeep).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Verwerfen' }));
    expect(pending.onDiscard).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Rückgängig' })).not.toBeInTheDocument();
  });

  it('says the change is applied in a moment while a countdown runs, or waits paused', () => {
    renderReview({ countdownEndsAt: Date.now() + 4000 });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Wird gleich übernommen; solange das Fenster offen ist, wartet es.',
    );
  });

  it('counts a countdown the open panel paused as one that runs', () => {
    renderReview({ countdownEndsAt: null, paused: true });
    expect(screen.getByRole('status')).toHaveTextContent('Wird gleich übernommen');
  });

  it('offers only Undo once the change is kept', async () => {
    const user = userEvent.setup();
    const { pending } = renderReview({ phase: 'kept' });

    expect(screen.getByRole('status')).toHaveTextContent('Übernommen.');
    expect(screen.queryByRole('button', { name: 'Behalten' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Verwerfen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Rückgängig' }));
    expect(pending.onUndo).toHaveBeenCalledTimes(1);
  });
});
