import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./toast', () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn() });
  return { toast };
});

import { toast } from './toast';
import { queryClient } from './queryClient';
import {
  captureMutation,
  enqueueMutation,
  getRecoveries,
  resetMutationSession,
} from './mutationQueue';

/** Runs the global failure handler the way a failed mutation does. */
const fail = (error: unknown) =>
  queryClient
    .getMutationCache()
    .config.onError?.(error as Error, undefined, undefined, { meta: {} } as never, {} as never);

beforeEach(() => {
  vi.clearAllMocks();
  resetMutationSession();
});

describe('one message for a failed write', () => {
  it('a refused write says why, once, with no Try again', () => {
    fail(Object.assign(new Error('x'), { status: 403, code: 'FORBIDDEN' }));
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'errors.refused.forbidden', tone: 'error' }),
    );
    expect(vi.mocked(toast).mock.calls[0]![0]).not.toHaveProperty('action');
  });

  it('a write gone meanwhile says so', () => {
    fail(Object.assign(new Error('x'), { status: 404, code: 'NOT_FOUND' }));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'errors.refused.gone' }));
  });

  it('a write that failed for a moment offers Try again, which resends that write', async () => {
    const ticket = captureMutation('note:z');
    const send = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ data: 'ok', revision: 2 });
    const error = await enqueueMutation(ticket, send).catch((e: unknown) => e);
    fail(error);
    const input = vi.mocked(toast).mock.calls[0]![0];
    expect(input).toMatchObject({ title: 'errors.saveFailed', action: { label: 'common.retry' } });
    input.action!.onClick();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(getRecoveries()).toEqual([]));
  });

  it('says nothing for a conflict (the review dialog has it) or a cancelled request', () => {
    fail(Object.assign(new Error('x'), { status: 409, code: 'STALE_REVISION' }));
    fail(new DOMException('Account changed', 'AbortError'));
    expect(toast).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
