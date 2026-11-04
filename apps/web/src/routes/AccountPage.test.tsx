import { beforeEach, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/features/account/downloadExport', () => ({ downloadExport: vi.fn() }));
vi.mock('@/features/account/DeleteAccountDialog', () => ({
  DeleteAccountDialog: ({ open }: { open: boolean }) => (open ? <div>delete dialog</div> : null),
}));

import { downloadExport } from '@/features/account/downloadExport';
import { renderWithProviders } from '@/test/renderWithProviders';
import { AccountSettings } from './AccountPage';

beforeEach(() => {
  vi.mocked(downloadExport).mockReset();
});

it('offers the download and the deletion', async () => {
  const user = userEvent.setup();
  renderWithProviders(<AccountSettings />);
  const download = screen.getByRole('button', { name: 'Download my data' });
  const remove = screen.getByRole('button', { name: 'Delete account' });
  expect(download).toBeEnabled();
  expect(remove).toBeEnabled();
  expect(download).toHaveAccessibleDescription(/one JSON file/);

  await user.click(download);
  expect(downloadExport).toHaveBeenCalledTimes(1);
  await user.click(remove);
  expect(screen.getByText('delete dialog')).toBeInTheDocument();
});

it('says when the download failed', async () => {
  vi.mocked(downloadExport).mockImplementation(async () => {
    throw new Error('offline');
  });
  const user = userEvent.setup();
  renderWithProviders(<AccountSettings />);
  await user.click(screen.getByRole('button', { name: 'Download my data' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Your data could not be downloaded. Try again.',
  );
});
