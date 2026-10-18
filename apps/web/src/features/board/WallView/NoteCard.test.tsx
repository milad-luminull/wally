import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import tailwindConfig from '../../../../tailwind.config';
import { makeNote, makeSuggestionMark } from '@/test/fixtures';
import type { SuggestionFields } from '@wally/shared';
import type { SuggestionMark } from '../Suggestions/useSuggestions';
import type { TidyMark } from '../Tidy/useTidy';
import { NoteCard } from './NoteCard';
import { NoteCardQuickActions } from './NoteCardActions';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';

/**
 * Regression cover for two drag defects, both caused by animating note cards on mount.
 *
 * 1. Cards did not follow the cursor. The `note-in` entry animation used
 *    `animation-fill-mode: both`, so once finished it kept applying its final `transform`
 *    keyframe. CSS animations outrank inline styles, so dnd-kit's drag transform was
 *    discarded every frame — measured as inline `translate3d(300px, 50px, 0)` against a
 *    computed `matrix(1, 0, 0, 1, 0, 0)`.
 *
 * 2. Cards flickered on drop. Moving a note to another zone re-parents it, so React
 *    unmounts and remounts the node — three times in 56ms once the optimistic patch and
 *    the settle refetch had both landed. Every remount restarted the entry animation from
 *    `opacity: 0`.
 *
 * Both share one cause: an element that re-parents during normal interaction must not
 * carry a mount-triggered animation.
 */
describe('NoteCard', () => {
  const animationNames = () =>
    Object.keys((tailwindConfig.theme?.extend?.animation as Record<string, string>) ?? {});

  it('defines no mount-triggered entry animation for note cards', () => {
    expect(animationNames()).not.toContain('note-in');
  });

  it('renders a resting card with no animation class', () => {
    render(
      <DndContext>
        <NoteCard note={makeNote()} currentUserId="user-1" selected={false} onOpen={vi.fn()} />
      </DndContext>,
    );

    const wrapper = screen.getByText('Approve the quote comparison').closest('[data-note-id]');
    expect(wrapper?.className ?? '').not.toMatch(/\banimate-/);
  });

  it('renders the drag overlay copy with no animation class', () => {
    const { container } = render(
      <NoteCard
        note={makeNote()}
        currentUserId="user-1"
        selected={false}
        onOpen={vi.fn()}
        overlay
      />,
    );

    const wrapper = container.querySelector('[data-note-overlay]');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.className ?? '').not.toMatch(/\banimate-/);

    // The overlay must not masquerade as a board card, or a drag would put two elements
    // with the same note id in the document.
    expect(container.querySelector('[data-note-id]')).toBeNull();
  });

  it('leaves positioning to the overlay instead of transforming the source card', () => {
    const { container } = render(
      <DndContext>
        <NoteCard note={makeNote()} currentUserId="user-1" selected={false} onOpen={vi.fn()} />
      </DndContext>,
    );

    // A resting card carries no inline transform; during a drag the overlay moves, not this.
    const wrapper = container.querySelector<HTMLElement>('[data-note-id]');
    expect(wrapper?.style.transform ?? '').toBe('');
  });
});

describe('NoteCard content', () => {
  const nora = { id: 'user-1', email: 'nora.falk@example.com', displayName: 'Nora Falk' };
  const jonas = { id: 'user-2', email: 'jonas@example.com', displayName: 'Jonas Weber' };

  function renderCard(note = makeNote(), currentUserId = 'user-1', relatedCount?: number) {
    return render(
      <DndContext>
        <NoteCard
          note={note}
          currentUserId={currentUserId}
          selected={false}
          onOpen={vi.fn()}
          relatedCount={relatedCount}
        />
      </DndContext>,
    );
  }

  // The card used to leave your own avatar off, so a note assigned to you looked exactly
  // like one assigned to nobody.
  it('shows the assignee when it is you, marked as yours', () => {
    renderCard(makeNote({ assignee: nora }));

    expect(screen.getByText('Assigned to you')).toBeInTheDocument();
    expect(screen.getByTitle('You')).toHaveTextContent('NF');
  });

  it('shows someone else as the assignee by name', () => {
    renderCard(makeNote({ assignee: jonas }));

    expect(screen.getByText('Assigned to Jonas Weber')).toBeInTheDocument();
    expect(screen.getByTitle('Jonas Weber')).toHaveTextContent('JW');
  });

  it('shows no assignee when nobody is assigned', () => {
    renderCard(makeNote({ assignee: null }));

    expect(screen.queryByText(/Assigned to/)).not.toBeInTheDocument();
  });

  it('previews the description under the title, and nothing when it is blank', () => {
    const { unmount } = renderCard(makeNote({ description: 'Check with Mr Weber' }));
    expect(screen.getByText('Check with Mr Weber')).toHaveClass('line-clamp-1');
    unmount();

    const { container } = renderCard(makeNote({ description: '   ' }));
    expect(container.querySelector('.line-clamp-1')).toBeNull();
  });

  it('shows a lock instead of the assignee on a private note', () => {
    renderCard(makeNote({ visibility: 'PRIVATE', assignee: nora, createdBy: nora }));

    expect(screen.getByRole('img', { name: 'Private note' })).toBeInTheDocument();
    expect(screen.queryByText('Assigned to you')).not.toBeInTheDocument();
    expect(screen.queryByTitle('You')).not.toBeInTheDocument();
  });

  it('shows no lock on a shared note', () => {
    renderCard(makeNote({ assignee: nora }));

    expect(screen.queryByRole('img', { name: 'Private note' })).not.toBeInTheDocument();
  });

  it('counts the related notes in the meta row, and shows nothing without any', () => {
    const { unmount } = renderCard(makeNote({ links: ['b', 'c'] }), 'user-1', 2);
    expect(screen.getByText('2 related')).toBeInTheDocument();
    unmount();

    renderCard(makeNote({ links: [] }));
    expect(screen.queryByText(/related/)).not.toBeInTheDocument();
  });

  // The count is what the board resolves (relatedCounts), not the raw id list: a deleted or
  // private-made target is not counted (L7), and a note only linked to counts its backlinks (L1).
  it('shows the related count the board resolves, not the length of its own id list', () => {
    const { unmount } = renderCard(makeNote({ links: ['b', 'gone'] }), 'user-1', 1);
    expect(screen.getByText('1 related')).toBeInTheDocument();
    expect(screen.queryByText('2 related')).not.toBeInTheDocument();
    unmount();

    const { unmount: unmountBacklinked } = renderCard(makeNote({ links: [] }), 'user-1', 1);
    expect(screen.getByText('1 related')).toBeInTheDocument();
    unmountBacklinked();

    renderCard(makeNote({ links: ['gone'] }), 'user-1', 0);
    expect(screen.queryByText(/related/)).not.toBeInTheDocument();
  });
});

describe('NoteCard with a pending change', () => {
  const pending = (over: Partial<SuggestionMark> = {}) => ({
    mark: makeSuggestionMark(over),
    onKeep: vi.fn(),
    onDiscard: vi.fn(),
    onUndo: vi.fn(),
    onRemove: vi.fn(),
    onSetField: vi.fn(),
    onSetSubtask: vi.fn(),
    onSetLink: vi.fn(),
    onPause: vi.fn(),
  });
  const renderCard = (p = pending()) => {
    render(
      <DndContext>
        <NoteCard
          note={makeNote({ dueDate: null, priority: 'MITTEL', assignee: null })}
          currentUserId="user-1"
          selected={false}
          onOpen={vi.fn()}
          pending={p}
        />
      </DndContext>,
    );
    return p;
  };

  it('draws a dashed edge, the dot, and each proposed field in its place with an ×', () => {
    const p = renderCard();
    const card = screen.getByText('Approve the quote comparison').closest('button')!;
    expect(card.className).toContain('border-dashed');
    expect(card.className).not.toMatch(/\banimate-/);
    expect(screen.getByRole('img', { name: /Proposed changes/ })).toBeInTheDocument();
    expect(screen.getByText(/Fri,? 10\/23/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove suggestion: High priority' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove suggestion: Assigned to Anna' }));
    expect(p.onRemove).toHaveBeenCalledWith('assignee');
  });

  it('keeps on Enter, discards on Esc, and never opens the note for those keys', () => {
    const onOpen = vi.fn();
    const p = pending();
    render(
      <DndContext>
        <NoteCard
          note={makeNote()}
          currentUserId="user-1"
          selected={false}
          onOpen={onOpen}
          pending={p}
        />
      </DndContext>,
    );
    const card = screen.getByText('Approve the quote comparison').closest('button')!;
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(p.onKeep).toHaveBeenCalledWith('enter');
    expect(p.onKeep).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(card, { key: 'Escape' });
    expect(p.onDiscard).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('pauses the countdown on hover and focus, and resumes on leave and blur', () => {
    const p = renderCard();
    const card = screen.getByText('Approve the quote comparison').closest('button')!;
    fireEvent.mouseEnter(card);
    expect(p.onPause).toHaveBeenLastCalledWith(true);
    fireEvent.mouseLeave(card);
    expect(p.onPause).toHaveBeenLastCalledWith(false);
    fireEvent.focus(card);
    expect(p.onPause).toHaveBeenLastCalledWith(true);
  });

  it('stays paused while either hover or focus still holds', () => {
    const p = renderCard();
    const card = screen.getByText('Approve the quote comparison').closest('button')!;
    // A keyboard user tabs in, then the pointer crosses the card: still paused.
    fireEvent.focus(card);
    fireEvent.mouseEnter(card);
    fireEvent.mouseLeave(card);
    expect(p.onPause).toHaveBeenCalledTimes(1);
    expect(p.onPause).toHaveBeenLastCalledWith(true);
    // Hovered, then focus leaves: still paused. Only when neither holds does it resume.
    fireEvent.mouseEnter(card);
    fireEvent.blur(card);
    expect(p.onPause).toHaveBeenLastCalledWith(true);
    fireEvent.mouseLeave(card);
    expect(p.onPause).toHaveBeenLastCalledWith(false);
    expect(p.onPause).toHaveBeenCalledTimes(2);
  });

  it('stays paused while focus moves from the card to one of its ×', () => {
    const p = renderCard();
    const card = screen.getByText('Approve the quote comparison').closest('button')!;
    const remove = screen.getByRole('button', { name: 'Remove suggestion: High priority' });
    fireEvent.focus(card);
    fireEvent.blur(card, { relatedTarget: remove });
    fireEvent.focus(remove);
    expect(p.onPause).toHaveBeenCalledTimes(1);
    expect(p.onPause).toHaveBeenLastCalledWith(true);
  });

  it('tells a screen reader on the focused card that a change is pending', () => {
    renderCard();
    const card = screen.getByText('Approve the quote comparison').closest('button')!;
    expect(card).toHaveAccessibleName(/Proposed changes, applied in a moment/);
    expect(card).toContainElement(screen.getByRole('img', { name: /Proposed changes/ }));
  });

  it('names the card as waiting for Enter when nothing counts down', () => {
    renderCard(pending({ countdownEndsAt: null }));
    const card = screen.getByText('Approve the quote comparison').closest('button')!;
    expect(card).toHaveAccessibleName(/Proposed changes, waiting for Enter/);
  });

  /** A pending mark whose suggestion also proposes a title, a reference or steps. */
  const withProposals = (
    fields: SuggestionMark['fields'],
    extra: Partial<SuggestionFields>,
    over: Partial<SuggestionMark> = {},
  ) => {
    const base = makeSuggestionMark();
    return pending({
      fields,
      suggestion: { ...base.suggestion!, fields: { ...base.suggestion!.fields, ...extra } },
      ...over,
    });
  };
  const TITLE = { value: 'Quote for Müller', reason: 'shorter' };

  it('offers a cleaner title as a second line, taken by a tap and dropped by its ×', () => {
    const onOpen = vi.fn();
    const p = withProposals(['dueDate'], { title: TITLE });
    const card = (q: typeof p) => (
      <DndContext>
        <NoteCard
          note={makeNote({ dueDate: null })}
          currentUserId="user-1"
          selected={false}
          onOpen={onOpen}
          pending={q}
        />
      </DndContext>
    );
    const { rerender } = render(card(p));
    // The person's own title stays; the offer is a line of its own beside it (BRAND rule 7).
    expect(screen.getByText('Approve the quote comparison')).toBeInTheDocument();
    const line = screen.getByRole('button', { name: 'Suggested: Quote for Müller' });
    expect(line).toHaveAttribute('aria-pressed', 'false');
    // What a press does, said only while the press would take the title.
    expect(line).toHaveAttribute('aria-description', 'Take the suggested title');
    fireEvent.click(line);
    expect(p.onSetField).toHaveBeenCalledWith('title', true);
    // Enter on the line takes the title; it neither keeps the change nor opens the note.
    fireEvent.keyDown(line, { key: 'Enter' });
    expect(p.onSetField).toHaveBeenCalledTimes(2);
    expect(p.onKeep).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();

    const taken = withProposals(['dueDate', 'title'], { title: TITLE });
    rerender(card(taken));
    const takenLine = screen.getByRole('button', { name: 'Suggested: Quote for Müller' });
    expect(takenLine).toHaveAttribute('aria-pressed', 'true');
    expect(takenLine).not.toHaveAttribute('aria-description');
    fireEvent.click(takenLine);
    expect(taken.onSetField).toHaveBeenCalledWith('title', false);
    fireEvent.click(screen.getByRole('button', { name: 'Keep my title' }));
    expect(taken.onRemove).toHaveBeenCalledWith('title');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('shows the reference and the step count with an × each', () => {
    const p = renderCard(
      withProposals(
        ['dueDate', 'reference', 'subtasks'],
        {
          reference: { key: 'Customer', value: 'Müller GmbH', reason: 'Müller' },
          subtasks: { items: ['Get prices', 'Compare', 'Approve'], reason: 'process' },
        },
        { subtasks: [0, 2] },
      ),
    );
    expect(screen.getByText('Customer: Müller GmbH')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove suggestion: Customer: Müller GmbH' }),
    );
    expect(p.onRemove).toHaveBeenCalledWith('reference');
    // The count is of the steps still ticked, in the checklist's place.
    expect(screen.getByText('2 steps')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove suggestion: 2 steps' }));
    expect(p.onRemove).toHaveBeenCalledWith('subtasks');
  });

  it('counts one step in the singular', () => {
    renderCard(
      withProposals(
        ['subtasks'],
        { subtasks: { items: ['Get prices', 'Compare'], reason: 'process' } },
        { subtasks: [1] },
      ),
    );
    expect(screen.getByText('1 step')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove suggestion: 1 step' })).toBeInTheDocument();
  });

  it('shows one line per ticked proposed link, each with an × that unticks it by its index', () => {
    const p = renderCard(
      withProposals(
        ['dueDate', 'links'],
        {
          links: {
            items: [
              { index: 0, noteId: 'b', title: 'Supplier list', reason: 'same supplier' },
              { index: 1, noteId: 'c', title: 'Budget', reason: 'same budget' },
              { index: 2, noteId: 'd', title: '', reason: 'same quote' },
            ],
            reason: 'related',
          },
        },
        { links: [0, 2] },
      ),
    );
    expect(screen.getByText('Related: Supplier list')).toBeInTheDocument();
    expect(screen.getByText('Related: Untitled')).toBeInTheDocument();
    // An unticked link leaves the card; the review still offers it.
    expect(screen.queryByText('Related: Budget')).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove suggestion: Related: Supplier list' }),
    );
    expect(p.onSetLink).toHaveBeenCalledWith(0, false);
    fireEvent.click(screen.getByRole('button', { name: 'Remove suggestion: Related: Untitled' }));
    expect(p.onSetLink).toHaveBeenLastCalledWith(2, false);
    expect(p.onRemove).not.toHaveBeenCalled();
  });

  it('keeps showing the kept values, without an ×, until the refetch carries them', () => {
    const base = makeSuggestionMark({ phase: 'kept', countdownEndsAt: null });
    const p = pending({
      phase: 'kept',
      countdownEndsAt: null,
      fields: ['dueDate', 'priority'],
      suggestion: {
        ...base.suggestion!,
        status: 'KEPT',
        kept: { fields: ['dueDate', 'priority'], subtasks: [], links: [], revision: 3 },
      },
    });
    renderCard(p);
    expect(screen.getByText(/Fri,? 10\/23/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Priority: High' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove suggestion/ })).toBeNull();
    // The person's own card is not dashed any more: this is the note, not a proposal.
    const card = screen.getByText('Approve the quote comparison').closest('button')!;
    expect(card.className).not.toContain('border-dashed');
  });

  it('looks like any other note once kept, with only the faint Undo left', () => {
    const p = renderCard(pending({ phase: 'kept', countdownEndsAt: null }));
    const card = screen.getByText('Approve the quote comparison').closest('button')!;
    expect(card.className).not.toContain('border-dashed');
    expect(screen.queryByRole('img', { name: /Proposed changes/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Undo the kept changes' }));
    expect(p.onUndo).toHaveBeenCalledWith('click');
    expect(p.onUndo).toHaveBeenCalledTimes(1);
  });
});

describe('NoteCard in a tidy batch', () => {
  const mark = (phase: TidyMark['phase'] = 'pending'): TidyMark => ({
    to: 'SPAETER',
    from: 'HEUTE',
    reason: null,
    source: 'date',
    phase,
  });
  function renderTidy(tidyMark = mark(), note = makeNote({ dueDate: '2026-10-23' })) {
    const tidy = {
      mark: tidyMark,
      onKeep: vi.fn(),
      onDiscard: vi.fn(),
      onUndo: vi.fn(),
      onRemove: vi.fn(),
    };
    render(
      <DndContext>
        <NoteCard
          note={note}
          currentUserId="user-1"
          selected={false}
          onOpen={vi.fn()}
          tidy={tidy}
        />
      </DndContext>,
    );
    const card = screen.getByRole('button', { name: /Approve the quote comparison/ });
    return { ...tidy, card };
  }

  it('shows the destination with the due date as its reason, the dashed edge and the waiting dot', () => {
    const { card } = renderTidy();
    expect(card).toHaveClass('border-dashed');
    expect(card).toHaveAttribute('data-tidy', 'pending');
    const line = screen.getByText('→ Later');
    // The suite renders in English, so the due date reads "Fri, 10/23".
    expect(line.closest('[title]')).toHaveAttribute(
      'title',
      expect.stringMatching(/^Because: Due Fri,? 10\/23$/),
    );
    expect(screen.getByRole('img', { name: 'To be moved, waiting for Enter' })).toBeInTheDocument();
    expect(card.querySelector('.animate-countdown')).toBeNull();
  });

  it('a move by words shows the model’s reason', () => {
    renderTidy({ ...mark(), reason: 'next month', source: 'words' }, makeNote({ dueDate: null }));
    expect(screen.getByText('→ Later').closest('[title]')).toHaveAttribute(
      'title',
      'Because: next month',
    );
  });

  it('a move by words without a reason has no tooltip', () => {
    renderTidy({ ...mark(), reason: null, source: 'words' }, makeNote({ dueDate: null }));
    expect(screen.getByText('→ Later').closest('[title]')).toBeNull();
  });

  it('Enter or Space on the × takes the note out and never keeps the batch', () => {
    const { onRemove, onKeep } = renderTidy();
    const x = screen.getByRole('button', { name: 'Do not move' });
    fireEvent.keyDown(x, { key: 'Enter', code: 'Enter' });
    fireEvent.keyDown(x, { key: ' ', code: 'Space' });
    expect(onRemove).toHaveBeenCalledTimes(2);
    expect(onKeep).not.toHaveBeenCalled();
  });

  it('Enter on a moved card is not the tidy’s: it reaches dnd-kit, which picks the card up', () => {
    const { card, onKeep, onUndo } = renderTidy(mark('kept'));
    expect(card).not.toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(card, { key: 'Enter', code: 'Enter' });
    expect(onKeep).not.toHaveBeenCalled();
    expect(onUndo).not.toHaveBeenCalled();
    expect(card).toHaveAttribute('aria-pressed', 'true');
  });

  it('the × takes the note out; Enter keeps the batch; Esc discards it', () => {
    const { card, onRemove, onKeep, onDiscard } = renderTidy();
    fireEvent.click(screen.getByRole('button', { name: 'Do not move' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onKeep).toHaveBeenCalledWith('enter');
    fireEvent.keyDown(card, { key: 'Escape' });
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('once moved, the edge is plain, Undo sits where the dot was and Esc undoes', () => {
    const { card, onUndo } = renderTidy(mark('kept'));
    expect(card).not.toHaveClass('border-dashed');
    expect(screen.queryByText('→ Later')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Undo the kept changes' }));
    expect(onUndo).toHaveBeenCalledWith('click');
    fireEvent.keyDown(card, { key: 'Escape' });
    expect(onUndo).toHaveBeenCalledWith('esc');
  });
});

describe('NoteCard quick actions', () => {
  function setup(editable = true, note = makeNote()) {
    const onOpen = vi.fn();
    const onExpand = vi.fn();
    const onDuplicate = vi.fn();
    const onDelete = vi.fn();
    const onZoneDoubleClick = vi.fn();
    renderWithProviders(
      <DndContext>
        <div onDoubleClick={onZoneDoubleClick}>
          <NoteCard
            note={note}
            currentUserId="user-1"
            selected={false}
            onOpen={onOpen}
            actions={{ onExpand, ...(editable ? { onDuplicate, onDelete } : {}) }}
          />
        </div>
      </DndContext>,
    );
    return { onOpen, onExpand, onDuplicate, onDelete, onZoneDoubleClick };
  }

  it('opens full-screen from the quick action without opening the side panel', async () => {
    const actions = setup();
    const expand = screen.getByRole('button', { name: 'Expand note' });
    expect(expand.parentElement?.closest('button')).toBeNull();
    await userEvent.click(expand);
    expect(actions.onExpand).toHaveBeenCalledTimes(1);
    expect(actions.onOpen).not.toHaveBeenCalled();
  });

  it('offers duplicate and delete in the More menu', async () => {
    const actions = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Note actions' }));
    await userEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    expect(actions.onDuplicate).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Note actions' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(actions.onDelete).toHaveBeenCalledTimes(1);
    expect(actions.onOpen).not.toHaveBeenCalled();
  });

  it('offers only full-screen viewing for a read-only card', () => {
    setup(false);
    expect(screen.getByRole('button', { name: 'Expand note' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Note actions' })).not.toBeInTheDocument();
  });

  it('expands with E and prevents double-click from triggering the zone create gesture', () => {
    const actions = setup();
    const card = screen.getByText('Approve the quote comparison').closest('button')!;
    fireEvent.keyDown(card, { key: 'e' });
    fireEvent.doubleClick(card);
    expect(actions.onExpand).toHaveBeenCalledTimes(1);
    expect(actions.onZoneDoubleClick).not.toHaveBeenCalled();
  });
  it('keeps quick actions unavailable while a copy is still saving', () => {
    setup(true, makeNote({ id: 'temp-copy' }));
    expect(screen.queryByRole('button', { name: 'Expand note' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Note actions' })).not.toBeInTheDocument();
  });

  it('does not restore menu focus over the duplicated editor', async () => {
    const duplicate = vi.fn(() => screen.getByLabelText('Copied note title').focus());
    renderWithProviders(
      <>
        <input aria-label="Copied note title" />
        <NoteCardQuickActions actions={{ onExpand: vi.fn(), onDuplicate: duplicate }} />
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Note actions' }));
    await userEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(duplicate).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Copied note title')).toHaveFocus();
  });
});
