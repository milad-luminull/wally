import { expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import { AccountSettings } from './AccountPage';

it('shows export and deletion as unavailable, with the address to write to meanwhile', () => {
  renderWithProviders(<AccountSettings />);
  const download = screen.getByRole('button', { name: 'Download my data' });
  const remove = screen.getByRole('button', { name: 'Delete account' });
  expect(download).toBeDisabled();
  expect(remove).toBeDisabled();
  expect(download).toHaveAccessibleDescription(/privacy@luminull\.com/);
  expect(remove).toHaveAccessibleDescription(/privacy@luminull\.com/);
});
