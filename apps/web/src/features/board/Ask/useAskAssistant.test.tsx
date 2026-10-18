import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { ApiError } from '@/lib/apiClient';

vi.mock('@/lib/resources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/resources')>()),
  assistantApi: { turn: vi.fn() },
}));

import { assistantApi } from '@/lib/resources';
import { useAskAssistant } from './useAskAssistant';

const conversation = (id: string) => ({
  id,
  boardId: 'b1',
  status: 'OPEN' as const,
  model: 'm',
  entries: [],
});

describe('useAskAssistant', () => {
  beforeEach(() => {
    vi.mocked(assistantApi.turn).mockReset();
  });

  it('sends the question with the browser date and zone', async () => {
    vi.mocked(assistantApi.turn).mockResolvedValue({ conversation: conversation('c1') });
    const { result } = renderHook(() => useAskAssistant('b1'));
    const outcome = await result.current('What is open?', null);
    expect(outcome).toEqual({ kind: 'answered', conversation: conversation('c1') });
    const [boardId, body] = vi.mocked(assistantApi.turn).mock.calls[0]!;
    expect(boardId).toBe('b1');
    expect(body).toMatchObject({ message: 'What is open?' });
    expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(body).not.toHaveProperty('conversationId');
  });

  it('retries once without the conversation id when the conversation closed', async () => {
    vi.mocked(assistantApi.turn)
      .mockRejectedValueOnce(new ApiError(409, { error: 'ASSISTANT_CONVERSATION_CLOSED' }))
      .mockResolvedValueOnce({ conversation: conversation('c2') });
    const { result } = renderHook(() => useAskAssistant('b1'));
    const outcome = await result.current('two', 'c1');
    expect(outcome).toMatchObject({ kind: 'answered', conversation: { id: 'c2' } });
    expect(vi.mocked(assistantApi.turn).mock.calls[0]![1]).toMatchObject({ conversationId: 'c1' });
    expect(vi.mocked(assistantApi.turn).mock.calls[1]![1]).not.toHaveProperty('conversationId');
  });

  it('maps a cap refusal to a refused outcome with the reset time', async () => {
    vi.mocked(assistantApi.turn).mockRejectedValue(
      new ApiError(429, {
        error: 'ASSISTANT_DAILY_CAP',
        message: 'x',
        resetsAt: '2026-10-16T00:00:00.000Z',
      }),
    );
    const { result } = renderHook(() => useAskAssistant('b1'));
    const outcome = await result.current('one', null);
    expect(outcome).toEqual({
      kind: 'refused',
      code: 'ASSISTANT_DAILY_CAP',
      resetsAt: '2026-10-16T00:00:00.000Z',
    });
  });

  it("maps the route's own rate limit to the busy refusal", async () => {
    vi.mocked(assistantApi.turn).mockRejectedValue(
      new ApiError(429, { error: 'RATE_LIMITED', message: 'Too many requests' }),
    );
    const { result } = renderHook(() => useAskAssistant('b1'));
    const outcome = await result.current('one', null);
    expect(outcome).toEqual({ kind: 'refused', code: 'ASSISTANT_BUSY', resetsAt: null });
  });

  it('maps anything else to failed', async () => {
    vi.mocked(assistantApi.turn).mockRejectedValueOnce(
      new ApiError(500, { error: 'INTERNAL_SERVER_ERROR' }),
    );
    const { result } = renderHook(() => useAskAssistant('b1'));
    const outcome = await result.current('two', null);
    expect(outcome).toEqual({ kind: 'failed' });
  });
});
