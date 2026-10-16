import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { renderWithProviders } from '@/test/renderWithProviders';
import { WandCanvas } from './WandCanvas';

// The canvas reads its backdrop from the profile; signed out, that query never runs.
vi.mock('@/features/auth/AuthProvider', async () => {
  const actual = await vi.importActual<typeof import('@/features/auth/AuthProvider')>(
    '@/features/auth/AuthProvider',
  );
  return { ...actual, useAuth: () => ({ status: 'unauthenticated', user: null }) };
});

vi.mock('../Capture/InlineCaptureCard', () => ({
  InlineCaptureCard: ({ placement }: { placement: { kind: string; x?: number; y?: number } }) => (
    <div data-testid="capture" data-x={placement.x} data-y={placement.y} />
  ),
}));

describe('WandCanvas capture', () => {
  it('asks for a capture at the double-click point and renders it there', () => {
    const onCapture = vi.fn();
    renderWithProviders(
      <DndContext>
        <WandCanvas
          notes={[]}
          filtered={false}
          currentUserId="u1"
          selectedNoteId={null}
          onOpenNote={vi.fn()}
          onCapture={onCapture}
          capture={null}
          onCaptureDone={vi.fn()}
          visibility="SHARED"
          boardId="b1"
          canEditShared
          activeDragId={null}
        />
      </DndContext>,
    );
    const surface = screen.getByTestId('wand-canvas');
    fireEvent.doubleClick(surface, { clientX: 300, clientY: 200 });
    expect(onCapture).toHaveBeenCalledWith(expect.objectContaining({ kind: 'free' }));
  });
  it('renders the capture card at its placement', () => {
    renderWithProviders(
      <DndContext>
        <WandCanvas
          notes={[]}
          filtered={false}
          currentUserId="u1"
          selectedNoteId={null}
          onOpenNote={vi.fn()}
          onCapture={vi.fn()}
          capture={{ kind: 'free', x: 120, y: 80 }}
          onCaptureDone={vi.fn()}
          visibility="SHARED"
          boardId="b1"
          canEditShared
          activeDragId={null}
        />
      </DndContext>,
    );
    const card = screen.getByTestId('capture');
    expect(card).toHaveAttribute('data-x', '120');
    expect(card.parentElement).toHaveStyle({ position: 'absolute', left: '120px', top: '80px' });
  });
});
