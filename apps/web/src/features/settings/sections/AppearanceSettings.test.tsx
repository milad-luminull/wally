import { beforeEach, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const setCanvasPattern = vi.fn();
vi.mock('@/lib/preferences', async () => {
  const actual = await vi.importActual<typeof import('@/lib/preferences')>('@/lib/preferences');
  return { ...actual, useCanvasPattern: () => ['dots', setCanvasPattern] };
});

import { renderWithProviders } from '@/test/renderWithProviders';
import { AppearanceSettings } from './AppearanceSettings';

beforeEach(() => setCanvasPattern.mockReset());

it('offers palette, mode and canvas background, each as a row', () => {
  renderWithProviders(<AppearanceSettings />);
  expect(screen.getByRole('heading', { level: 1, name: 'Appearance' })).toBeInTheDocument();
  expect(screen.getByLabelText('Colour palette')).toBeInTheDocument();
  const mode = screen.getByRole('group', { name: 'Mode' });
  for (const name of ['System', 'Light', 'Dark']) {
    expect(within(mode).getByRole('button', { name })).toBeInTheDocument();
  }
  expect(screen.getByText('Follows your device when set to System.')).toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Free canvas background' })).toBeInTheDocument();
});

it('saves the canvas background', async () => {
  renderWithProviders(<AppearanceSettings />);
  await userEvent.click(screen.getByRole('button', { name: 'Grid' }));
  expect(setCanvasPattern).toHaveBeenCalledWith('grid');
});
