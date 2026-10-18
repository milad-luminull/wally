import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToday } from './useToday';

describe('useToday', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // A minute before midnight, local time.
    vi.setSystemTime(new Date(2026, 9, 17, 23, 59, 0));
  });
  afterEach(() => vi.useRealTimers());

  it('is the browser’s calendar date, and turns at each local midnight', async () => {
    const { result } = renderHook(() => useToday());
    expect(result.current).toBe('2026-10-17');
    await act(() => vi.advanceTimersByTimeAsync(61_000));
    expect(result.current).toBe('2026-10-18');
    await act(() => vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000));
    expect(result.current).toBe('2026-10-19');
  });
});
