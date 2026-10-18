import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { AssistantConversationDto } from '@wally/shared';
import type { AskOutcome } from './useAskAssistant';

const askTurn = vi.fn<(message: string, conversationId: string | null) => Promise<AskOutcome>>();
vi.mock('./useAskAssistant', () => ({ useAskAssistant: () => askTurn }));

import {
  FADE_MS,
  READ_BASE_MS,
  READ_MAX_MS,
  READ_PER_WORD_MS,
  readingTimeMs,
  useAskSession,
} from './useAskSession';

const AT = '2026-10-17T10:00:00.000Z';
const FREE = { kind: 'free', x: 10, y: 20 } as const;

function conversation(id: string, text: string): AssistantConversationDto {
  return {
    id,
    boardId: 'b1',
    status: 'OPEN',
    model: 'm',
    entries: [
      { role: 'user', text: 'q', chips: [], partial: false, stopped: null, at: AT },
      {
        role: 'assistant',
        text,
        chips: [{ id: 'n1', title: 'Call Müller' }],
        partial: false,
        stopped: null,
        at: AT,
      },
    ],
  };
}
const answered = (id: string, text = 'Two notes are open.'): AskOutcome => ({
  kind: 'answered',
  conversation: conversation(id, text),
});

/** Resolves the mocked turn and lets the hook store the outcome. */
const settle = () => act(() => vi.advanceTimersByTimeAsync(0));

describe('readingTimeMs', () => {
  it('is a floor, a share per word and a ceiling', () => {
    expect(readingTimeMs('')).toBe(READ_BASE_MS);
    expect(readingTimeMs('one two  three\nfour five six seven eight nine ten')).toBe(
      READ_BASE_MS + 10 * READ_PER_WORD_MS,
    );
    expect(readingTimeMs(Array.from({ length: 200 }, () => 'w').join(' '))).toBe(READ_MAX_MS);
  });
});

describe('useAskSession', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    askTurn.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('asks with no conversation, shows the answer, fades after the reading time and goes', async () => {
    askTurn.mockResolvedValue(answered('c1', 'one two three four'));
    const { result } = renderHook(() => useAskSession('b1'));
    act(() => result.current.ask('What is open?', FREE));
    expect(result.current.session).toMatchObject({
      phase: 'asking',
      question: 'What is open?',
      placement: FREE,
    });
    await settle();
    expect(askTurn).toHaveBeenCalledWith('What is open?', null);
    expect(result.current.session).toMatchObject({
      phase: 'answered',
      answer: { text: 'one two three four' },
    });

    const reading = READ_BASE_MS + 4 * READ_PER_WORD_MS;
    await act(() => vi.advanceTimersByTimeAsync(reading - 1));
    expect(result.current.session?.phase).toBe('answered');
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(result.current.session?.phase).toBe('fading');
    await act(() => vi.advanceTimersByTimeAsync(FADE_MS));
    expect(result.current.session).toBeNull();
  });

  it('remembers whether the card may take the focus: only a question asked with Enter', async () => {
    askTurn.mockResolvedValue(answered('c1'));
    const { result } = renderHook(() => useAskSession('b1'));
    act(() => result.current.ask('What is open?', FREE, true));
    expect(result.current.session?.takeFocus).toBe(true);
    act(() => result.current.ask('What is late?', FREE, false));
    expect(result.current.session?.takeFocus).toBe(false);
    await settle();
    expect(result.current.session).toMatchObject({ phase: 'answered', takeFocus: false });
  });

  it('continues the conversation while its card shows, and starts afresh once it is gone', async () => {
    askTurn
      .mockResolvedValueOnce(answered('c1'))
      .mockResolvedValueOnce(answered('c1'))
      .mockResolvedValueOnce(answered('c2'));
    const { result } = renderHook(() => useAskSession('b1'));
    act(() => result.current.ask('What is open?', FREE));
    await settle();
    act(() => result.current.ask('And mine?', FREE));
    await settle();
    expect(askTurn).toHaveBeenLastCalledWith('And mine?', 'c1');

    act(() => result.current.dismiss());
    await act(() => vi.advanceTimersByTimeAsync(FADE_MS));
    expect(result.current.session).toBeNull();
    act(() => result.current.ask('What is late?', FREE));
    await settle();
    expect(askTurn).toHaveBeenLastCalledWith('What is late?', null);
  });

  it('a pause holds the clock and resumes with what was left', async () => {
    askTurn.mockResolvedValue(answered('c1', ''));
    const { result } = renderHook(() => useAskSession('b1'));
    act(() => result.current.ask('Open?', FREE));
    await settle();
    await act(() => vi.advanceTimersByTimeAsync(3000));
    act(() => result.current.pause(true));
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(result.current.session?.phase).toBe('answered');
    act(() => result.current.pause(false));
    await act(() => vi.advanceTimersByTimeAsync(READ_BASE_MS - 3000 - 1));
    expect(result.current.session?.phase).toBe('answered');
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(result.current.session?.phase).toBe('fading');
  });

  it('a pin holds the card; unpinning starts the full reading time again', async () => {
    askTurn.mockResolvedValue(answered('c1', ''));
    const { result } = renderHook(() => useAskSession('b1'));
    act(() => result.current.ask('Open?', FREE));
    await settle();
    await act(() => vi.advanceTimersByTimeAsync(5000));
    act(() => result.current.setPinned(true));
    await act(() => vi.advanceTimersByTimeAsync(120_000));
    expect(result.current.session).toMatchObject({ phase: 'answered', pinned: true });
    act(() => result.current.setPinned(false));
    await act(() => vi.advanceTimersByTimeAsync(READ_BASE_MS - 1));
    expect(result.current.session?.phase).toBe('answered');
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(result.current.session?.phase).toBe('fading');
  });

  it('a dismissal while asking fades the card, and the late answer sets no conversation', async () => {
    let resolve!: (o: AskOutcome) => void;
    askTurn.mockReturnValueOnce(new Promise<AskOutcome>((r) => (resolve = r)));
    askTurn.mockResolvedValueOnce(answered('c2'));
    const { result } = renderHook(() => useAskSession('b1'));
    act(() => result.current.ask('Open?', FREE));
    act(() => result.current.dismiss());
    expect(result.current.session?.phase).toBe('fading');
    await act(() => vi.advanceTimersByTimeAsync(FADE_MS));
    expect(result.current.session).toBeNull();
    await act(async () => {
      resolve(answered('c1'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.session).toBeNull();
    act(() => result.current.ask('Late?', FREE));
    await settle();
    expect(askTurn).toHaveBeenLastCalledWith('Late?', null);
  });

  it('a second question replaces the first card; the first answer is not shown', async () => {
    let resolveFirst!: (o: AskOutcome) => void;
    askTurn.mockReturnValueOnce(new Promise<AskOutcome>((r) => (resolveFirst = r)));
    askTurn.mockResolvedValueOnce(answered('c1', 'second'));
    const { result } = renderHook(() => useAskSession('b1'));
    act(() => result.current.ask('First?', FREE));
    act(() => result.current.ask('Second?', { kind: 'list' }));
    await settle();
    expect(result.current.session).toMatchObject({
      question: 'Second?',
      phase: 'answered',
      answer: { text: 'second' },
    });
    await act(async () => {
      resolveFirst(answered('c9', 'first'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.session).toMatchObject({
      question: 'Second?',
      answer: { text: 'second' },
    });
  });

  it('a refusal and a failure stay for the base time', async () => {
    askTurn.mockResolvedValueOnce({ kind: 'refused', code: 'ASSISTANT_DAILY_CAP', resetsAt: AT });
    const { result } = renderHook(() => useAskSession('b1'));
    act(() => result.current.ask('Open?', FREE));
    await settle();
    expect(result.current.session).toMatchObject({
      phase: 'refused',
      refusal: { code: 'ASSISTANT_DAILY_CAP', resetsAt: AT },
    });
    await act(() => vi.advanceTimersByTimeAsync(READ_BASE_MS));
    expect(result.current.session?.phase).toBe('fading');

    askTurn.mockResolvedValueOnce({ kind: 'failed' });
    act(() => result.current.ask('Open?', FREE));
    await settle();
    expect(result.current.session?.phase).toBe('failed');
  });
});
