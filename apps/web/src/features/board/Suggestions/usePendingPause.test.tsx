import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { makeSuggestionMark } from '@/test/fixtures';
import type { PendingProps } from './pendingProps';
import { usePendingPause } from './usePendingPause';
import type { SuggestionPhase } from './useSuggestions';

/** A card as far as the pause is concerned: a focusable root with the handlers on it. */
function Card({ pending }: { pending: PendingProps }) {
  const pause = usePendingPause(pending);
  return (
    <div role="button" tabIndex={0} data-testid="card" {...pause}>
      <span>note</span>
    </div>
  );
}

function pendingAt(phase: SuggestionPhase, onPause: (paused: boolean) => void): PendingProps {
  return {
    mark: makeSuggestionMark({
      phase,
      suggestion: phase === 'asking' ? null : makeSuggestionMark().suggestion,
    }),
    onKeep: vi.fn(),
    onDiscard: vi.fn(),
    onUndo: vi.fn(),
    onRemove: vi.fn(),
    onSetField: vi.fn(),
    onSetSubtask: vi.fn(),
    onSetLink: vi.fn(),
    onPause,
  };
}

describe('usePendingPause', () => {
  it('pauses on hover after a commit focused the card while the mark was still asking', () => {
    const onPause = vi.fn();
    const { rerender } = render(<Card pending={pendingAt('asking', onPause)} />);
    const card = screen.getByTestId('card');
    // The board focuses the committed card (useCaptureSession) before the proposal arrives.
    act(() => card.focus());
    expect(card).toHaveFocus();
    rerender(<Card pending={pendingAt('pending', onPause)} />);
    onPause.mockClear();

    fireEvent.mouseEnter(card);
    expect(onPause).toHaveBeenLastCalledWith(true);
    fireEvent.mouseLeave(card);
    expect(onPause).toHaveBeenLastCalledWith(false);
    expect(onPause).toHaveBeenCalledTimes(2);
  });

  it('pauses on a focus that arrives after the mark turned pending', () => {
    const onPause = vi.fn();
    const { rerender } = render(
      <>
        <Card pending={pendingAt('asking', onPause)} />
        <button type="button">elsewhere</button>
      </>,
    );
    const card = screen.getByTestId('card');
    act(() => card.focus());
    rerender(
      <>
        <Card pending={pendingAt('pending', onPause)} />
        <button type="button">elsewhere</button>
      </>,
    );
    onPause.mockClear();
    // Away and back: that focus is the person's own.
    act(() => screen.getByRole('button', { name: 'elsewhere' }).focus());
    expect(onPause).not.toHaveBeenCalled();
    act(() => card.focus());
    expect(onPause).toHaveBeenLastCalledWith(true);
  });

  it('pauses at once when the pointer is already on the card as the proposal arrives', () => {
    const onPause = vi.fn();
    const { rerender } = render(<Card pending={pendingAt('asking', onPause)} />);
    fireEvent.mouseEnter(screen.getByTestId('card'));
    onPause.mockClear();
    rerender(<Card pending={pendingAt('pending', onPause)} />);
    expect(onPause).toHaveBeenLastCalledWith(true);
  });

  it('lets go of its hold when it unmounts under the pointer, and only then', () => {
    const onPause = vi.fn();
    const hovered = render(<Card pending={pendingAt('pending', onPause)} />);
    fireEvent.mouseEnter(screen.getByTestId('card'));
    expect(onPause).toHaveBeenLastCalledWith(true);
    hovered.unmount();
    expect(onPause).toHaveBeenLastCalledWith(false);
    expect(onPause).toHaveBeenCalledTimes(2);

    const idle = vi.fn();
    render(<Card pending={pendingAt('pending', idle)} />).unmount();
    expect(idle).not.toHaveBeenCalled();
  });
});
