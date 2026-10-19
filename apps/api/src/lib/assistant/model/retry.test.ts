import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../errors.js';
import { isTemporaryProviderError, withOneRetry } from './retry.js';

const providerError = (statusCode: number) =>
  Object.assign(new Error('provider'), { name: 'AI_APICallError', statusCode });

describe('isTemporaryProviderError', () => {
  it('counts a busy provider, a provider fault and a dropped connection as temporary', () => {
    expect(isTemporaryProviderError(providerError(429))).toBe(true);
    expect(isTemporaryProviderError(providerError(503))).toBe(true);
    expect(isTemporaryProviderError(new TypeError('fetch failed'))).toBe(true);
    expect(isTemporaryProviderError(Object.assign(new Error('x'), { isRetryable: true }))).toBe(
      true,
    );
  });
  it('never counts a refusal, our own error, or an abort', () => {
    expect(isTemporaryProviderError(providerError(400))).toBe(false);
    expect(isTemporaryProviderError(providerError(403))).toBe(false);
    expect(isTemporaryProviderError(new AppError(429, 'ASSISTANT_BUSY', 'x'))).toBe(false);
    expect(isTemporaryProviderError(new DOMException('aborted', 'AbortError'))).toBe(false);
  });
});

describe('withOneRetry', () => {
  const setup = (overrides: Partial<Parameters<typeof withOneRetry>[1]> = {}) => {
    const controller = new AbortController();
    const sleep = vi.fn(async () => {});
    return {
      controller,
      sleep,
      options: {
        signal: controller.signal,
        deadlineAt: 20_000,
        minAttemptMs: 3_000,
        delayMs: () => 1_000,
        now: () => 1_000,
        sleep,
        ...overrides,
      },
    };
  };

  it('tries once more after a temporary failure, after the pause', async () => {
    const { options, sleep } = setup();
    const attempt = vi.fn().mockRejectedValueOnce(providerError(429)).mockResolvedValueOnce('ok');
    await expect(withOneRetry(attempt, options)).resolves.toBe('ok');
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1_000, options.signal);
  });

  it('tries only once more: a second failure is the answer', async () => {
    const { options } = setup();
    const attempt = vi.fn().mockRejectedValue(providerError(503));
    await expect(withOneRetry(attempt, options)).rejects.toMatchObject({ statusCode: 503 });
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('never retries a refusal', async () => {
    const { options } = setup();
    const attempt = vi.fn().mockRejectedValue(providerError(400));
    await expect(withOneRetry(attempt, options)).rejects.toMatchObject({ statusCode: 400 });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('does not retry when the deadline leaves no room for a whole attempt', async () => {
    const { options } = setup({ now: () => 17_500 });
    const attempt = vi.fn().mockRejectedValue(providerError(429));
    await expect(withOneRetry(attempt, options)).rejects.toMatchObject({ statusCode: 429 });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('does not retry once the call was aborted', async () => {
    const { options, controller } = setup();
    controller.abort();
    const attempt = vi.fn().mockRejectedValue(providerError(429));
    await expect(withOneRetry(attempt, options)).rejects.toMatchObject({ statusCode: 429 });
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});
