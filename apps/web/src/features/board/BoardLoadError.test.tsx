import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import { BoardLoadError } from './BoardLoadError';

describe('BoardLoadError', () => {
  it('says the notes could not be loaded, never an empty board, and Try again reloads them', async () => {
    const onRetry = vi.fn();
    renderWithProviders(<BoardLoadError onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t load the notes');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
