import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import tailwindConfig from '../../../../tailwind.config';
import { makeNote } from '@/test/fixtures';
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
});
