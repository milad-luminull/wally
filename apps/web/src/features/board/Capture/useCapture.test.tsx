import { expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { NOTE_CARD_WIDTH } from '@wally/shared';
import { notesApi } from '@/lib/resources';
import { makeNote } from '@/test/fixtures';
import { createTestQueryClient } from '@/test/renderWithProviders';
import { scopedQueryKeys } from '../hooks/queryKeys';
import { useCapture, type CapturePlacement } from './useCapture';

vi.mock('@/lib/resources', () => ({ notesApi: { create: vi.fn() } }));
const keys = scopedQueryKeys(null);
beforeEach(() => vi.resetAllMocks());

it.each<CapturePlacement>([
  { kind: 'list' },
  { kind: 'zone', axis: 'priority', key: 'HOCH', at: { freeX: 32, freeY: 32 } },
  { kind: 'zone', axis: 'horizon', key: 'HEUTE', at: { freeX: 32, freeY: 32 } },
])(
  'assigns an unoccupied wall position to a $kind capture using the whole board',
  async (placement) => {
    const client = createTestQueryClient();
    // The existing note can be hidden by the current view's filter. Its position is still taken.
    client.setQueryData(keys.notes('board'), [makeNote({ freeX: 32, freeY: 32 })]);
    vi.mocked(notesApi.create).mockImplementation(async (_board, input) =>
      makeNote({ ...input, id: 'new' }),
    );
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => useCapture('board', placement, 'SHARED', { onDone: vi.fn() }),
      { wrapper },
    );
    act(() => result.current.onFirstKeystroke({ title: 'New', description: '' }));
    await waitFor(() => expect(notesApi.create).toHaveBeenCalledTimes(1));
    const input = vi.mocked(notesApi.create).mock.calls[0]![1];
    expect(input.freeX).toBeGreaterThanOrEqual(32 + NOTE_CARD_WIDTH);
    expect(input.freeY).toBeGreaterThan(0);
    if (placement.kind === 'zone') expect(input[placement.axis]).toBe(placement.key);
  },
);

it('preserves the location explicitly chosen on the free wall', async () => {
  const client = createTestQueryClient();
  vi.mocked(notesApi.create).mockResolvedValue(makeNote());
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(
    () => useCapture('board', { kind: 'free', x: 700, y: 300 }, 'SHARED', { onDone: vi.fn() }),
    { wrapper },
  );
  act(() => result.current.onFirstKeystroke({ title: 'New', description: '' }));
  await waitFor(() =>
    expect(notesApi.create).toHaveBeenCalledWith(
      'board',
      expect.objectContaining({ freeX: 700, freeY: 300 }),
    ),
  );
});
