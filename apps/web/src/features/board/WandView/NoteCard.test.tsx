import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import tailwindConfig from '../../../../tailwind.config';
import { makeNote, makeSuggestionMark } from '@/test/fixtures';
import type { SuggestionMark } from '../Suggestions/useSuggestions';
import { NoteCard } from './NoteCard';

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

    const wrapper = screen.getByText('Angebotsvergleich freigeben').closest('[data-note-id]');
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

  function renderCard(note = makeNote(), currentUserId = 'user-1') {
    return render(
      <DndContext>
        <NoteCard note={note} currentUserId={currentUserId} selected={false} onOpen={vi.fn()} />
      </DndContext>,
    );
  }

  // The card used to leave your own avatar off, so a note assigned to you looked exactly
  // like one assigned to nobody.
  it('shows the assignee when it is you, marked as yours', () => {
    renderCard(makeNote({ assignee: nora }));

    expect(screen.getByText('Dir zugewiesen')).toBeInTheDocument();
    expect(screen.getByTitle('Du')).toHaveTextContent('NF');
  });

  it('shows someone else as the assignee by name', () => {
    renderCard(makeNote({ assignee: jonas }));

    expect(screen.getByText('Zuständig: Jonas Weber')).toBeInTheDocument();
    expect(screen.getByTitle('Jonas Weber')).toHaveTextContent('JW');
  });

  it('shows no assignee when nobody is assigned', () => {
    renderCard(makeNote({ assignee: null }));

    expect(screen.queryByText(/Zuständig|Dir zugewiesen/)).not.toBeInTheDocument();
  });

  it('previews the description under the title, and nothing when it is blank', () => {
    const { unmount } = renderCard(makeNote({ description: 'Mit Herrn Weber abstimmen' }));
    expect(screen.getByText('Mit Herrn Weber abstimmen')).toHaveClass('line-clamp-1');
    unmount();

    const { container } = renderCard(makeNote({ description: '   ' }));
    expect(container.querySelector('.line-clamp-1')).toBeNull();
  });

  it('shows a lock instead of the assignee on a private note', () => {
    renderCard(makeNote({ visibility: 'PRIVATE', assignee: nora, createdBy: nora }));

    expect(screen.getByRole('img', { name: 'Private Notiz' })).toBeInTheDocument();
    expect(screen.queryByText('Dir zugewiesen')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Du')).not.toBeInTheDocument();
  });

  it('shows no lock on a shared note', () => {
    renderCard(makeNote({ assignee: nora }));

    expect(screen.queryByRole('img', { name: 'Private Notiz' })).not.toBeInTheDocument();
  });
});

describe('NoteCard with a pending change', () => {
  const pending = (over: Partial<SuggestionMark> = {}) => ({
    mark: makeSuggestionMark(over),
    onKeep: vi.fn(),
    onDiscard: vi.fn(),
    onUndo: vi.fn(),
    onRemove: vi.fn(),
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
    const card = screen.getByText('Angebotsvergleich freigeben').closest('button')!;
    expect(card.className).toContain('border-dashed');
    expect(card.className).not.toMatch(/\banimate-/);
    expect(screen.getByRole('img', { name: /Vorgeschlagene/ })).toBeInTheDocument();
    expect(screen.getByText(/Fr\.?,? 23\.10\./)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Vorschlag entfernen: Priorität hoch' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Vorschlag entfernen: Zuständig: Anna' }));
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
    const card = screen.getByText('Angebotsvergleich freigeben').closest('button')!;
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(p.onKeep).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(card, { key: 'Escape' });
    expect(p.onDiscard).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('pauses the countdown on hover and focus, and resumes on leave and blur', () => {
    const p = renderCard();
    const card = screen.getByText('Angebotsvergleich freigeben').closest('button')!;
    fireEvent.mouseEnter(card);
    expect(p.onPause).toHaveBeenLastCalledWith(true);
    fireEvent.mouseLeave(card);
    expect(p.onPause).toHaveBeenLastCalledWith(false);
    fireEvent.focus(card);
    expect(p.onPause).toHaveBeenLastCalledWith(true);
  });

  it('stays paused while either hover or focus still holds', () => {
    const p = renderCard();
    const card = screen.getByText('Angebotsvergleich freigeben').closest('button')!;
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
    const card = screen.getByText('Angebotsvergleich freigeben').closest('button')!;
    const remove = screen.getByRole('button', { name: 'Vorschlag entfernen: Priorität hoch' });
    fireEvent.focus(card);
    fireEvent.blur(card, { relatedTarget: remove });
    fireEvent.focus(remove);
    expect(p.onPause).toHaveBeenCalledTimes(1);
    expect(p.onPause).toHaveBeenLastCalledWith(true);
  });

  it('tells a screen reader on the focused card that a change is pending', () => {
    renderCard();
    const card = screen.getByText('Angebotsvergleich freigeben').closest('button')!;
    expect(card).toHaveAccessibleName(/Vorgeschlagene Änderungen, werden gleich übernommen/);
    expect(card).toContainElement(screen.getByRole('img', { name: /Vorgeschlagene/ }));
  });

  it('names the card as waiting for Enter when nothing counts down', () => {
    renderCard(pending({ countdownEndsAt: null }));
    const card = screen.getByText('Angebotsvergleich freigeben').closest('button')!;
    expect(card).toHaveAccessibleName(/Vorgeschlagene Änderungen, warten auf Enter/);
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
        kept: { fields: ['dueDate', 'priority'], subtasks: [], revision: 3 },
      },
    });
    renderCard(p);
    expect(screen.getByText(/Fr\.?,? 23\.10\./)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Priorität: Hoch' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Vorschlag entfernen/ })).toBeNull();
    // The person's own card is not dashed any more: this is the note, not a proposal.
    const card = screen.getByText('Angebotsvergleich freigeben').closest('button')!;
    expect(card.className).not.toContain('border-dashed');
  });

  it('looks like any other note once kept, with only the faint Undo left', () => {
    const p = renderCard(pending({ phase: 'kept', countdownEndsAt: null }));
    const card = screen.getByText('Angebotsvergleich freigeben').closest('button')!;
    expect(card.className).not.toContain('border-dashed');
    expect(screen.queryByRole('img', { name: /Vorgeschlagene/ })).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Übernommene Änderungen rückgängig machen' }),
    );
    expect(p.onUndo).toHaveBeenCalledTimes(1);
  });
});
