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
    expect(screen.getByText('Filling in')).toBeInTheDocument();
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

  it('draws no line above the footer', () => {
    render(<ReviewFooter mark={makeSuggestionMark()} onKeep={vi.fn()} onUndo={vi.fn()} />);
    expect(document.querySelector('[data-review-footer]')?.className).not.toMatch(/border-t/);
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

  describe('an outcome line', () => {
    const outcome = (o: NonNullable<Parameters<typeof makeSuggestionMark>[0]>['outcome']) =>
      makeSuggestionMark({ phase: 'outcome', outcome: o });

    it('says "Nothing to add" and asks nothing of the person', () => {
      render(
        <ReviewFooter
          mark={outcome({ kind: 'nothing', canRetry: false })}
          onKeep={vi.fn()}
          onUndo={vi.fn()}
        />,
      );
      expect(screen.getByRole('status')).toHaveTextContent('Nothing to add');
      expect(screen.queryByRole('button')).toBeNull();
    });

    it('says the AI is busy, with Try again and ×', () => {
      const onRetry = vi.fn();
      const onDismiss = vi.fn();
      render(
        <ReviewFooter
          mark={outcome({ kind: 'busy', canRetry: true })}
          onKeep={vi.fn()}
          onUndo={vi.fn()}
          onRetry={onRetry}
          onDismiss={onDismiss}
        />,
      );
      expect(screen.getByRole('status')).toHaveTextContent('Busy right now');
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(onRetry).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('says when a daily limit lifts', () => {
      render(
        <ReviewFooter
          mark={outcome({
            kind: 'limit',
            code: 'ASSISTANT_DAILY_CAP',
            resetsAt: '2026-10-20T00:00:00Z',
            canRetry: false,
          })}
          onKeep={vi.fn()}
          onUndo={vi.fn()}
          onDismiss={vi.fn()}
        />,
      );
      expect(screen.getByRole('status')).toHaveTextContent(
        /^Daily limit reached · available again from /,
      );
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    });

    it('says a decision could not be saved, and that a changed note closed it', () => {
      const { rerender } = render(
        <ReviewFooter
          mark={outcome({ kind: 'saveFailed', canRetry: true })}
          onKeep={vi.fn()}
          onUndo={vi.fn()}
          onRetry={vi.fn()}
          onDismiss={vi.fn()}
        />,
      );
      expect(screen.getByRole('status')).toHaveTextContent('Couldn’t save');
      rerender(
        <ReviewFooter
          mark={outcome({ kind: 'changed', canRetry: false })}
          onKeep={vi.fn()}
          onUndo={vi.fn()}
        />,
      );
      expect(screen.getByRole('status')).toHaveTextContent('This changed meanwhile');
    });
  });
});
