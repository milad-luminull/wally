import { expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import { AppearanceControls } from './AppearanceControls';

/** The signed-out landing page renders these; splitting them up must not change it. */
it("keeps the landing page's palette and mode controls", () => {
  renderWithProviders(<AppearanceControls />);
  expect(screen.getByLabelText('Colour palette')).toBeInTheDocument();
  const mode = screen.getByRole('group', { name: 'Appearance' });
  for (const name of ['System', 'Light', 'Dark']) {
    expect(within(mode).getByRole('button', { name })).toBeInTheDocument();
  }
});
