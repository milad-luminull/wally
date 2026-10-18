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
    remove: vi.fn(),
    ...over,
  };
}

describe('TidyBar', () => {
  it('is an empty strip while there is nothing to tidy', () => {
    renderWithProviders(<TidyBar tidy={controller()} />);
    const bar = screen.getByRole('toolbar', { name: 'Tidy' });
    expect(bar).toHaveAttribute('data-tidy-phase', 'idle');
    expect(bar.textContent).toBe('');
  });

  it('offers to tidy the counted notes', async () => {
    const tidy = controller({ count: 4 });
    renderWithProviders(<TidyBar tidy={tidy} />);
    await userEvent.click(screen.getByRole('button', { name: 'Tidy 4 notes' }));
    expect(tidy.tidy).toHaveBeenCalledTimes(1);
  });

  it('says it is sorting, then offers Move and Discard for the pending batch', async () => {
    const asking = controller({ phase: 'asking' });
    const { rerender } = renderWithProviders(<TidyBar tidy={asking} />);
    expect(screen.getByText('Sorting…')).toBeInTheDocument();
    const pending = controller({ phase: 'pending', moving: 3 });
    rerender(<TidyBar tidy={pending} />);
    expect(screen.getByText('3 notes move')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Move' }));
    expect(pending.keep).toHaveBeenCalledWith('click');
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(pending.discard).toHaveBeenCalledWith('click');
  });

  it('after a keep it says how many moved and offers Undo; when empty it says so', async () => {
    const kept = controller({ phase: 'kept', moving: 2 });
    const { rerender } = renderWithProviders(<TidyBar tidy={kept} />);
    expect(screen.getByText('2 notes moved')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(kept.undo).toHaveBeenCalledWith('click');
    rerender(<TidyBar tidy={controller({ phase: 'empty' })} />);
    expect(screen.getByText('Nothing to tidy.')).toBeInTheDocument();
  });
});
