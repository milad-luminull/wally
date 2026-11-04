import { beforeEach, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MemberDto } from '@wally/shared';

const auth = vi.hoisted(() => ({
  signOut: vi.fn(async () => {}),
}));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { uid: 'me', email: 'Me@Example.com', displayName: 'Me' },
    signOut: auth.signOut,
  }),
}));
vi.mock('@/lib/resources', () => ({
  boardsApi: {
    list: vi.fn(async () => [
      { id: 'team', name: 'Team board', currentUserRole: 'OWNER' },
      { id: 'theirs', name: 'Their board', currentUserRole: 'EDIT' },
    ]),
  },
  membersApi: {
    list: vi.fn(async (): Promise<MemberDto[]> => [
      member('me', 'Me', 'me@example.com', 'OWNER'),
      member('ada', 'Ada', 'ada@example.com', 'EDIT'),
      member('ben', null, 'ben@example.com', 'VIEW'),
    ]),
  },
}));
vi.mock('@/lib/apiClient', () => ({ api: { delete: vi.fn() } }));

import { api } from '@/lib/apiClient';
import { renderWithProviders } from '@/test/renderWithProviders';
import { ACCOUNT_DELETED_FLAG, DeleteAccountDialog } from './DeleteAccountDialog';

function member(
  userId: string,
  displayName: string | null,
  email: string,
  role: MemberDto['role'],
): MemberDto {
  return { id: userId, userId, displayName, email, role, status: 'ACTIVE' };
}

beforeEach(() => {
  auth.signOut.mockClear();
  vi.mocked(api.delete).mockReset();
  sessionStorage.clear();
});

const open = () => renderWithProviders(<DeleteAccountDialog open onOpenChange={() => {}} />);

it('lists the boards that are deleted for everyone, with who else is on them', async () => {
  open();
  expect(await screen.findByText('Team board — shared with Ada, ben@example.com')).toBeVisible();
  expect(screen.queryByText(/Their board/)).not.toBeInTheDocument();
});

it('unlocks the delete button only when the typed text is the email, ignoring case and spaces', async () => {
  const user = userEvent.setup();
  open();
  const confirm = screen.getByRole('button', { name: 'Delete my account' });
  expect(confirm).toBeDisabled();
  await user.type(screen.getByLabelText('Type Me@Example.com to confirm'), 'me@example.co');
  expect(confirm).toBeDisabled();
  await user.type(screen.getByLabelText('Type Me@Example.com to confirm'), 'm ');
  expect(confirm).toBeEnabled();
});

it('deletes, marks the login page, and signs out once', async () => {
  vi.mocked(api.delete).mockResolvedValue(undefined);
  const user = userEvent.setup();
  open();
  await user.type(screen.getByLabelText('Type Me@Example.com to confirm'), 'me@example.com');
  await user.click(screen.getByRole('button', { name: 'Delete my account' }));
  await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
  expect(api.delete).toHaveBeenCalledWith('/me');
  expect(sessionStorage.getItem(ACCOUNT_DELETED_FLAG)).toBe('1');
});

it('says nothing was removed when the deletion fails, and stays signed in', async () => {
  vi.mocked(api.delete).mockImplementation(async () => {
    throw new Error('502');
  });
  const user = userEvent.setup();
  open();
  await user.type(screen.getByLabelText('Type Me@Example.com to confirm'), 'me@example.com');
  await user.click(screen.getByRole('button', { name: 'Delete my account' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Your account could not be deleted. Nothing was removed. Try again.',
  );
  expect(auth.signOut).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(ACCOUNT_DELETED_FLAG)).toBeNull();
});
