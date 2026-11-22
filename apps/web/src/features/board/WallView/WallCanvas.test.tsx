import { makeNote } from '@/test/fixtures';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { FREE_CANVAS_WIDTH, type NoteDto } from '@wally/shared';
import { renderWithProviders } from '@/test/renderWithProviders';
import type { BoxSlot } from '../WallyBox/boxSlot';
import { ANCHORED_BOX_WIDTH, WallCanvas } from './WallCanvas';

// The canvas reads its backdrop from the profile; signed out, that query never runs.
vi.mock('@/features/auth/AuthProvider', async () => {
  const actual = await vi.importActual<typeof import('@/features/auth/AuthProvider')>(
    '@/features/auth/AuthProvider',
  );
  return { ...actual, useAuth: () => ({ status: 'unauthenticated', user: null }) };
});

function renderCanvas({
  notes = [],
  box = null,
  onCapture = vi.fn(),
}: { notes?: NoteDto[]; box?: BoxSlot | null; onCapture?: () => void } = {}) {
  return renderWithProviders(
    <DndContext>
      <WallCanvas
        notes={notes}
        filtered={false}
        currentUserId="u1"
        selectedNoteId={null}
        onOpenNote={vi.fn()}
        onCapture={onCapture}
        box={box}
        canEditShared
        activeDragId={null}
      />
    </DndContext>,
  );
}

const boxAt = (x: number, y: number): BoxSlot => ({
  key: 1,
  placement: { kind: 'free', x, y },
  node: <div data-wally-box="anchored" data-testid="box" />,
});

describe('WallCanvas', () => {
  it('draws kept links beneath the cards', () => {
    const { container } = renderCanvas({
      notes: [makeNote({ id: 'a', links: ['b'] }), makeNote({ id: 'b' })],
    });
    expect(container.querySelectorAll('[data-link-lines] line')).toHaveLength(1);
  });

  it('asks for the box at the double-click point', () => {
    const onCapture = vi.fn();
    renderCanvas({ onCapture });
    fireEvent.doubleClick(screen.getByTestId('wall-canvas'), { clientX: 300, clientY: 200 });
    // jsdom lays the canvas out at the origin, unscrolled: the point is the client point.
    expect(onCapture).toHaveBeenCalledWith({ kind: 'free', x: 300, y: 200 });
  });

  it('draws the anchored box at its point', () => {
    renderCanvas({ box: boxAt(120, 80) });
    expect(screen.getByTestId('box').parentElement).toHaveStyle({ left: '120px', top: '80px' });
  });

  it('keeps a box opened near the right edge on the canvas', () => {
    renderCanvas({ box: boxAt(FREE_CANVAS_WIDTH - 50, 80) });
    expect(screen.getByTestId('box').parentElement).toHaveStyle({
      left: `${FREE_CANVAS_WIDTH - ANCHORED_BOX_WIDTH}px`,
    });
  });

  it('does not start a note when a word in the box is double-clicked', () => {
    const onCapture = vi.fn();
    renderCanvas({ box: boxAt(120, 80), onCapture });
    fireEvent.doubleClick(screen.getByTestId('box'));
    expect(onCapture).not.toHaveBeenCalled();
  });

  it('shows no empty state while the box is open on an empty canvas', () => {
    renderCanvas({ box: boxAt(120, 80) });
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });
});
