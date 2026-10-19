import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import { TidyBar } from './TidyBar';
import type { TidyController } from './useTidy';

function controller(over: Partial<TidyController> = {}): TidyController {
  return {
    phase: 'idle',
    count: 0,
    moving: 0,
    trackedIds: [],
    markFor: () => undefined,
    tidy: vi.fn(),
    keep: vi.fn(),
    discard: vi.fn(),
    undo: vi.fn(),
    undoLast: vi.fn(() => false),
    lastKeptAt: () => null,
    remove: vi.fn(),
    failure: null,
    retry: vi.fn(),
    dismissFailure: vi.fn(),
    ...over,
  };
}

const strip = () => document.querySelector<HTMLElement>('[data-tidy-bar]')!;

describe('TidyBar', () => {
  it('is an empty strip, not a toolbar, while there is nothing to tidy', () => {
    renderWithProviders(<TidyBar tidy={controller()} />);
    expect(strip()).toHaveAttribute('data-tidy-phase', 'idle');
    expect(strip().textContent).toBe('');
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    // The live region is there before anything is said in it.
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('offers to tidy the counted notes, as a toolbar', async () => {
    const tidy = controller({ count: 4 });
    renderWithProviders(<TidyBar tidy={tidy} />);
    const bar = screen.getByRole('toolbar', { name: 'Tidy' });
    expect(bar).toBe(strip());
    expect(bar).not.toHaveAttribute('aria-live');
    await userEvent.click(screen.getByRole('button', { name: 'Tidy 4 notes' }));
    expect(tidy.tidy).toHaveBeenCalledTimes(1);
  });

  it('says it is sorting, then offers Move and Discard for the pending batch', async () => {
    const asking = controller({ phase: 'asking' });
    const { rerender } = renderWithProviders(<TidyBar tidy={asking} />);
    expect(screen.getByRole('status')).toHaveTextContent('Sorting…');
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    const pending = controller({ phase: 'pending', moving: 3 });
    rerender(<TidyBar tidy={pending} />);
    expect(screen.getByRole('toolbar', { name: 'Tidy' })).toBeInTheDocument();
    // The live region says the outcome alone, never the buttons' names.
    expect(screen.getByRole('status')).toHaveTextContent(/^3 notes move$/);
    await userEvent.click(screen.getByRole('button', { name: 'Move' }));
    expect(pending.keep).toHaveBeenCalledWith('click');
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(pending.discard).toHaveBeenCalledWith('click');
  });

  it('after a keep it says how many moved and offers Undo; when empty it says so', async () => {
    const kept = controller({ phase: 'kept', moving: 2 });
    const { rerender } = renderWithProviders(<TidyBar tidy={kept} />);
    expect(screen.getByRole('status')).toHaveTextContent(/^2 notes moved$/);
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(kept.undo).toHaveBeenCalledWith('click');
    rerender(<TidyBar tidy={controller({ phase: 'empty' })} />);
    expect(screen.getByRole('status')).toHaveTextContent('All in its place.');
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  });

  it('says why a Tidy could not help, with Try again and ×, as a toolbar', async () => {
    const tidy = controller({
      phase: 'failed',
      failure: { kind: 'busy', canRetry: true },
    });
    renderWithProviders(<TidyBar tidy={tidy} />);
    expect(screen.getByRole('status')).toHaveTextContent('Busy right now');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(tidy.retry).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(tidy.dismissFailure).toHaveBeenCalledTimes(1);
  });

  it('says a keep did not get through, and an undo that did not happen, in its own words', () => {
    const { rerender } = renderWithProviders(
      <TidyBar
        tidy={controller({ phase: 'failed', failure: { kind: 'saveFailed', canRetry: true } })}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Couldn’t move the notes');
    rerender(
      <TidyBar
        tidy={controller({ phase: 'failed', failure: { kind: 'undoFailed', canRetry: false } })}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Couldn’t undo the move');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});
