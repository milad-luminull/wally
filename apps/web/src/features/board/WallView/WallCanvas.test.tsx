import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { renderWithProviders } from '@/test/renderWithProviders';
import { WallCanvas } from './WallCanvas';

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

describe('WallCanvas capture', () => {
  it('asks for a capture at the double-click point', () => {
    const onCapture = vi.fn();
    renderWithProviders(
      <DndContext>
        <WallCanvas
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
    const surface = screen.getByTestId('wall-canvas');
    fireEvent.doubleClick(surface, { clientX: 300, clientY: 200 });
    // jsdom lays the canvas out at the origin, unscrolled: the point is the client point.
    expect(onCapture).toHaveBeenCalledWith({ kind: 'free', x: 300, y: 200 });
  });

  it('renders the capture card at its placement', () => {
    renderWithProviders(
      <DndContext>
        <WallCanvas
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

describe('WallCanvas answer card', () => {
  function render(
    ask: { key: number; placement: { kind: 'free'; x: number; y: number }; card: ReactNode } | null,
  ) {
    renderWithProviders(
      <DndContext>
        <WallCanvas
          notes={[]}
          filtered={false}
          currentUserId="u1"
          selectedNoteId={null}
          onOpenNote={vi.fn()}
          onCapture={vi.fn()}
          capture={null}
          onCaptureDone={vi.fn()}
          visibility="SHARED"
          boardId="b1"
          canEditShared
          activeDragId={null}
          ask={ask}
        />
      </DndContext>,
    );
  }

  it('draws the answer card where the question was written', () => {
    render({
      key: 1,
      placement: { kind: 'free', x: 120, y: 80 },
      card: <div data-testid="answer" />,
    });
    const card = screen.getByTestId('answer');
    expect(card.parentElement).toHaveAttribute('data-ask');
    expect(card.parentElement).toHaveStyle({ position: 'absolute', left: '120px', top: '80px' });
    // The card is there instead of the empty wall's prompt.
    expect(screen.queryByText('Free canvas')).not.toBeInTheDocument();
  });

  it('keeps a card written near the right edge on the canvas', () => {
    render({
      key: 1,
      placement: { kind: 'free', x: 2300, y: 80 },
      card: <div data-testid="answer" />,
    });
    expect(screen.getByTestId('answer').parentElement).toHaveStyle({ left: `${2400 - 376}px` });
  });

  it('does not start a note when a word in the answer is double-clicked', () => {
    const onCapture = vi.fn();
    renderWithProviders(
      <DndContext>
        <WallCanvas
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
          ask={{
            key: 1,
            placement: { kind: 'free', x: 120, y: 80 },
            card: <div data-testid="answer" />,
          }}
        />
      </DndContext>,
    );
    fireEvent.doubleClick(screen.getByTestId('answer'));
    expect(onCapture).not.toHaveBeenCalled();
  });
});
