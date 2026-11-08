import { expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const setWallybot = vi.fn();
vi.mock('@/lib/preferences', async () => {
  const actual = await vi.importActual<typeof import('@/lib/preferences')>('@/lib/preferences');
  return { ...actual, useWallybotPreferences: () => [{ autoApply: true }, setWallybot] };
});

import { renderWithProviders } from '@/test/renderWithProviders';
import { WallybotSettings } from './WallybotSettings';

it('offers "always ask me", explained by its hint, and saves it', async () => {
  renderWithProviders(<WallybotSettings />);
  const alwaysAsk = screen.getByRole('switch', { name: 'Always ask me' });
  expect(alwaysAsk).toHaveAttribute('aria-checked', 'false');
  expect(alwaysAsk).toHaveAccessibleDescription(
    'Suggestions wait for Enter instead of applying on their own.',
  );
  await userEvent.click(alwaysAsk);
  expect(setWallybot).toHaveBeenCalledWith({ autoApply: false });
});
