import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import tailwindConfig from '../../../../tailwind.config';
import { makeNote, makeSuggestionMark } from '@/test/fixtures';
import type { SuggestionFields } from '@wally/shared';
import type { SuggestionMark } from '../Suggestions/useSuggestions';
import type { TidyMark } from '../Tidy/useTidy';
import { NoteCard } from './NoteCard';
import { i18n } from '@/i18n';
import { dueInfo } from '../util/noteDerived';
/** A date as the card's own meta line words it (Tomorrow, Fri…), which the rows reuse. */
const dueWords = (iso: string) => dueInfo({ status: 'OPEN', dueDate: iso }, i18n.t).label;
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
    onSetTag: vi.fn(),
    onSetProperty: vi.fn(),
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

  it('wraps the card in the moving border, with the proposed fields as rows with an × each', () => {
    const p = renderCard();
    const card = screen.getByText('Approve the quote comparison').closest('button')!;
    const shell = card.closest('[data-capture-card]')!;
    expect(shell.className).toContain('capture-glow');
    // The border and the rows mark the change; there is no corner dot any more.
    expect(screen.queryByRole('img', { name: /Proposed changes/ })).toBeNull();
    const list = screen.getByRole('list', { name: 'Suggested fields' });
    expect(within(list).getByText(dueWords('2026-10-23'))).toBeInTheDocument();
    expect(
      within(list).getByRole('button', { name: 'Leave out: Priority High' }),
    ).toBeInTheDocument();
    fireEvent.click(within(list).getByRole('button', { name: 'Leave out: Person Anna' }));
    expect(p.onSetField).toHaveBeenCalledWith('assignee', false);
    // Everything is in the rows: the card's own meta line waits until the decision.
    expect(card.querySelector('[data-note-meta]')).toBeNull();
  });

  it('a pending change shows the list and the footer and hides the done checkbox', () => {
    const p = renderCard();
    expect(screen.getByRole('list', { name: 'Suggested fields' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(p.onKeep).toHaveBeenCalledWith('click');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(p.onDiscard).toHaveBeenCalledTimes(1);
    const card = screen.getByText('Approve the quote comparison').closest('button')!;
    // The done circle leaves the card under review, so the title lines up with the rows.
    expect(card.querySelector('.paper-note-status')).toBeNull();
  });

  it("the list and footer sit beside the card's button, so its name stays the note", () => {
    renderCard();
    const card = screen.getByText('Approve the quote comparison').closest('button')!;
    expect(within(card).queryByRole('list')).toBeNull();
    expect(card.querySelector('[data-review-footer]')).toBeNull();
    const review = card.parentElement!.querySelector('[data-note-review]')!;
    expect(
      within(review as HTMLElement).getByRole('list', { name: 'Suggested fields' }),
    ).toBeInTheDocument();
    expect(within(review as HTMLElement).getByRole('button', { name: 'Keep' })).toBeInTheDocument();
  });

  it('Esc on a row of the review discards, as on the card', () => {
    const p = renderCard();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Leave out: Priority High' }), {
      key: 'Escape',
    });
    expect(p.onDiscard).toHaveBeenCalledTimes(1);
  });

  it('while the call runs the words shimmer, the card says it is filling in, and there is no list', () => {
    renderCard(pending({ phase: 'asking', suggestion: null, countdownEndsAt: null }));
    expect(screen.getByText('Approve the quote comparison').className).toContain('capture-shimmer');
    expect(screen.getByText('Filling in')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Suggested fields' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Keep' })).toBeNull();
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
    const remove = screen.getByRole('button', { name: 'Leave out: Priority High' });
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

  it('keeps the person’s title on the card and offers the new one in the Title row, its text in a Text row', () => {
    const description = { value: 'For the Müller quote.', reason: 'moved out' };
    const on = withProposals(['dueDate', 'title', 'description'], { title: TITLE, description });
    render(
      <DndContext>
        <NoteCard
          note={makeNote({ dueDate: null })}
          currentUserId="user-1"
          selected={false}
          onOpen={vi.fn()}
          pending={on}
        />
      </DndContext>,
    );
    const button = screen.getAllByRole('button')[0]!;
    expect(within(button).getByText('Approve the quote comparison')).toBeInTheDocument();
    expect(within(button).queryByText('Quote for Müller')).toBeNull();
    const list = screen.getByRole('list', { name: 'Suggested fields' });
    expect(within(list).getByText('Quote for Müller')).toBeInTheDocument();
    expect(within(list).getByText('For the Müller quote.')).toBeInTheDocument();
    expect(screen.queryByText('Reworded')).toBeNull();
    fireEvent.click(
      within(list).getByRole('button', { name: 'Leave out: Title Quote for Müller' }),
    );
    expect(on.onSetField).toHaveBeenCalledWith('title', false);
  });

  it('shows the reference and each step as rows with an × each', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Leave out: Customer Müller GmbH' }));
    expect(p.onSetField).toHaveBeenCalledWith('reference', false);
    // Each step is a row; the unticked one is crossed out and can be brought back.
    fireEvent.click(screen.getByRole('button', { name: 'Leave out: Step Approve' }));
    expect(p.onSetSubtask).toHaveBeenCalledWith(2, false);
    fireEvent.click(screen.getByRole('button', { name: 'Bring back: Step Compare' }));
    expect(p.onSetSubtask).toHaveBeenCalledWith(1, true);
  });

  it('shows one row per proposed link, each toggled by its stored index', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Leave out: Related Supplier list' }));
    expect(p.onSetLink).toHaveBeenCalledWith(0, false);
    fireEvent.click(screen.getByRole('button', { name: 'Leave out: Related Untitled' }));
    expect(p.onSetLink).toHaveBeenLastCalledWith(2, false);
    // An unticked link stays as a crossed-out row that can come back.
    fireEvent.click(screen.getByRole('button', { name: 'Bring back: Related Budget' }));
    expect(p.onSetLink).toHaveBeenLastCalledWith(1, true);
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
        kept: {
          fields: ['dueDate', 'priority'],
          subtasks: [],
          links: [],
          tags: [],
          properties: [],
          revision: 3,
        },
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
    // Neither the list nor the footer outlives the keep.
    expect(screen.queryByRole('list', { name: 'Suggested fields' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Keep' })).toBeNull();
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
            actions={{ onOpen, onExpand, ...(editable ? { onDuplicate, onDelete } : {}) }}
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

  it('offers opening but no editing actions on a read-only card', async () => {
    const actions = setup(false);
    expect(screen.getByRole('button', { name: 'Expand note' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Note actions' }));
    expect(screen.queryByRole('button', { name: 'Duplicate' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark as done' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Make private' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(actions.onOpen).toHaveBeenCalledTimes(1));
    expect(actions.onExpand).not.toHaveBeenCalled();
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
        <NoteCardQuickActions
          actions={{ onOpen: vi.fn(), onExpand: vi.fn(), onDuplicate: duplicate }}
        />
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Note actions' }));
    await userEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(duplicate).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Copied note title')).toHaveFocus();
  });
  it.each([
    [false, 'Mark as done'],
    [true, 'Mark as open'],
  ])('offers the matching completion action (completed: %s)', async (isDone, label) => {
    const toggle = vi.fn();
    renderWithProviders(
      <NoteCardQuickActions
        actions={{ onOpen: vi.fn(), onExpand: vi.fn(), isDone, onToggleStatus: toggle }}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Note actions' }));
    await userEvent.click(screen.getByRole('button', { name: label }));
    await waitFor(() => expect(toggle).toHaveBeenCalledTimes(1));
  });

  it('offers making private only when allowed and returns focus after changing a card', async () => {
    const makePrivate = vi.fn();
    renderWithProviders(
      <NoteCardQuickActions
        actions={{ onOpen: vi.fn(), onExpand: vi.fn(), onMakePrivate: makePrivate }}
      />,
    );
    const more = screen.getByRole('button', { name: 'Note actions' });
    await userEvent.click(more);
    await userEvent.click(screen.getByRole('button', { name: 'Make private' }));
    await waitFor(() => expect(makePrivate).toHaveBeenCalledTimes(1));
    expect(more).toHaveFocus();
  });
});

it('identifies the card shown in the detail panel and clears that state when closed', () => {
  const note = makeNote();
  const { rerender } = render(
    <DndContext>
      <NoteCard note={note} currentUserId="user-1" selected onOpen={vi.fn()} />
    </DndContext>,
  );
  const card = screen.getByText(note.title).closest('button')!;
  expect(card).toHaveAttribute('aria-current', 'true');
  rerender(
    <DndContext>
      <NoteCard note={note} currentUserId="user-1" selected={false} onOpen={vi.fn()} />
    </DndContext>,
  );
  expect(card).not.toHaveAttribute('aria-current');
});

describe('NoteCard with an outcome line', () => {
  it('says why nothing came on the card, and Try again, × and Esc reach the controller', () => {
    const onRetry = vi.fn();
    const onDismiss = vi.fn();
    render(
      <DndContext>
        <NoteCard
          note={makeNote()}
          currentUserId="user-1"
          selected={false}
          onOpen={vi.fn()}
          pending={{
            mark: makeSuggestionMark({
              phase: 'outcome',
              outcome: { kind: 'busy', canRetry: true },
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
            onRetry,
            onDismiss,
          }}
        />
      </DndContext>,
    );
    expect(screen.getByText('Busy right now')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Suggested fields' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    fireEvent.keyDown(screen.getAllByRole('button')[0]!, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });
});
