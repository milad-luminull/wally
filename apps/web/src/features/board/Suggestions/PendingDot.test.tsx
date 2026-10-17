import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SuggestionMark } from './useSuggestions';
import { PendingDot } from './PendingDot';

const mark = (over: Partial<SuggestionMark> = {}): SuggestionMark => ({
  phase: 'pending',
  suggestion: null,
  fields: ['dueDate'],
  subtasks: [],
  titleDismissed: false,
  countdownEndsAt: Date.now() + 6000,
  countdownMs: 6000,
  paused: false,
  ...over,
});

describe('PendingDot', () => {
  it('is a marigold dot with a sweeping ring while a countdown runs', () => {
    const { container } = render(<PendingDot mark={mark()} onUndo={vi.fn()} />);
    const dot = screen.getByRole('img', {
      name: 'Vorgeschlagene Änderungen, werden gleich übernommen',
    });
    expect(dot).toBeInTheDocument();
    expect(container.querySelector('circle.fill-accent')).not.toBeNull();
    const ring = container.querySelector('circle.animate-countdown');
    expect(ring).not.toBeNull();
    expect(ring?.getAttribute('style')).toContain('--ring-ms: 6000ms');
  });

  it('holds the ring still while paused and draws none while waiting for Enter', () => {
    const paused = render(
      <PendingDot mark={mark({ paused: true, countdownEndsAt: null })} onUndo={vi.fn()} />,
    );
    expect(
      paused.container.querySelector<SVGCircleElement>('circle.animate-countdown')?.className
        .baseVal,
    ).toContain('[animation-play-state:paused]');
    paused.unmount();
    const waiting = render(<PendingDot mark={mark({ countdownEndsAt: null })} onUndo={vi.fn()} />);
    expect(
      screen.getByRole('img', { name: 'Vorgeschlagene Änderungen, warten auf Enter' }),
    ).toBeInTheDocument();
    expect(waiting.container.querySelector('circle.animate-countdown')).toBeNull();
  });

  it('shows a faint Undo where the dot was once the changes are kept', async () => {
    const onUndo = vi.fn();
    render(<PendingDot mark={mark({ phase: 'kept', countdownEndsAt: null })} onUndo={onUndo} />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Übernommene Änderungen rückgängig machen' }),
    );
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('dims the dot while asking, with no ring', () => {
    const { container } = render(
      <PendingDot
        mark={mark({ phase: 'asking', countdownEndsAt: null, fields: [] })}
        onUndo={vi.fn()}
      />,
    );
    expect(screen.getByRole('img', { name: 'Wird ausgefüllt' })).toBeInTheDocument();
    expect(container.querySelector('circle.animate-countdown')).toBeNull();
  });
});
