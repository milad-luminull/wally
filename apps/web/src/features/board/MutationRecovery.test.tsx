import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';
import { MutationRecovery } from './MutationRecovery';
import {
  captureMutation,
  enqueueMutation,
  getRecoveries,
  rememberResource,
  resetMutationSession,
} from '@/lib/mutationQueue';

beforeEach(() => resetMutationSession());
it('keeps a failed draft reachable and applies it only after reviewing the latest version', async () => {
  rememberResource('note:a', 1);
  const original = captureMutation('note:a');
  let calls = 0;
  await enqueueMutation(
    original,
    async (metadata) => {
      calls++;
      if (calls === 1) throw Object.assign(new Error('stale'), { code: 'STALE_REVISION' });
      expect(metadata.expectedRevision).toBe(4);
      expect(metadata.operationId).not.toBe(original.operationId);
      return { data: null, revision: 5 };
    },
    {
      action: 'update',
      input: { title: 'My draft' },
      loadLatest: async () => ({ data: { title: 'Colleague title' }, revision: 4 }),
    },
  ).catch(() => {});
  renderWithProviders(<MutationRecovery />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /Unsaved changes/ }));
  expect(await screen.findByText('Colleague title')).toBeInTheDocument();
  expect(screen.getByText('My draft')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Keep for later' }));
  expect(getRecoveries()).toHaveLength(1);
  await user.click(screen.getByRole('button', { name: /Unsaved changes/ }));
  await screen.findByText('Colleague title');
  await act(async () => {
    await user.click(screen.getByRole('button', { name: 'Apply reviewed change' }));
  });
  await waitFor(() => expect(getRecoveries()).toHaveLength(0));
  expect(calls).toBe(2);
});

it('shows a visibility change in words, not as the stored value', async () => {
  rememberResource('note:v', 1);
  const original = captureMutation('note:v');
  await enqueueMutation(
    original,
    async () => {
      throw Object.assign(new Error('stale'), { code: 'STALE_REVISION' });
    },
    {
      action: 'update',
      input: { visibility: 'PRIVATE' },
      loadLatest: async () => ({ data: { visibility: 'SHARED' }, revision: 4 }),
    },
  ).catch(() => {});
  renderWithProviders(<MutationRecovery />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /Unsaved changes/ }));

  // Once for the stored version, once for the proposed change.
  expect(await screen.findAllByText('Visibility')).toHaveLength(2);
  expect(await screen.findByText('Private')).toBeInTheDocument();
  expect(screen.getByText('Everyone')).toBeInTheDocument();
  expect(screen.queryByText('PRIVATE')).not.toBeInTheDocument();
  expect(screen.queryByText('SHARED')).not.toBeInTheDocument();
});
