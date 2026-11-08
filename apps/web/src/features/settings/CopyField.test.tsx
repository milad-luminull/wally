import { expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import { CopyField } from './CopyField';

it('copies its value and says so', async () => {
  const user = userEvent.setup();
  const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  renderWithProviders(<CopyField id="url" label="Connector URL" value="https://api.example/mcp" />);
  expect(screen.getByLabelText('Connector URL')).toHaveValue('https://api.example/mcp');
  await user.click(screen.getByRole('button', { name: 'Copy Connector URL' }));
  expect(writeText).toHaveBeenCalledWith('https://api.example/mcp');
  expect(await screen.findByRole('status')).toHaveTextContent('Copied');
});
