import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { makeSuggestionMark } from '@/test/fixtures';
import { ReviewFooter } from './ReviewFooter';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('ReviewFooter', () => {
  it('shows Filling in while asking, with no buttons', () => {
    render(
      <ReviewFooter
        mark={makeSuggestionMark({ phase: 'asking', suggestion: null })}
        onKeep={vi.fn()}
        onUndo={vi.fn()}
      />,
    );
    expect(screen.getByText('Filling in…')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('counts down whole seconds and shows Paused when paused', () => {
    const mark = makeSuggestionMark({
      countdownEndsAt: Date.now() + 15_000,
      countdownMs: 15_000,
    });
    const { rerender } = render(<ReviewFooter mark={mark} onKeep={vi.fn()} onUndo={vi.fn()} />);
    expect(screen.getByText('Saves in 15 s')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.getByText('Saves in 12 s')).toBeInTheDocument();
    rerender(
      <ReviewFooter
        mark={{ ...mark, paused: true, countdownEndsAt: null }}
        onKeep={vi.fn()}
        onUndo={vi.fn()}
      />,
    );
    expect(screen.getByText('Paused')).toBeInTheDocument();
  });

  it('says nothing about time when no countdown runs', () => {
    render(
      <ReviewFooter
        mark={makeSuggestionMark({ countdownEndsAt: null })}
        onKeep={vi.fn()}
        onUndo={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Saves in|Paused/)).toBeNull();
  });

  it('Keep keeps and Undo undoes, and neither press reaches the card', () => {
    const onKeep = vi.fn();
    const onUndo = vi.fn();
    const onCard = vi.fn();
    render(
      <div onClick={onCard} onKeyDown={onCard}>
        <ReviewFooter mark={makeSuggestionMark()} onKeep={onKeep} onUndo={onUndo} />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Undo' }), { key: 'Enter' });
    expect(onKeep).toHaveBeenCalledTimes(1);
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onCard).not.toHaveBeenCalled();
  });

  it('Keep is always active, even with everything crossed out', () => {
    const onKeep = vi.fn();
    const onUndo = vi.fn();
    render(
      <ReviewFooter
        mark={makeSuggestionMark({ fields: [], countdownEndsAt: null })}
        onKeep={onKeep}
        onUndo={onUndo}
      />,
    );
    const keep = screen.getByRole('button', { name: 'Keep' });
    expect(keep).not.toHaveAttribute('aria-disabled');
    fireEvent.click(keep);
    expect(onKeep).toHaveBeenCalledTimes(1);
  });
});
