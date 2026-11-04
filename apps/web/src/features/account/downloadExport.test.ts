import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@/lib/apiClient', () => ({
  api: { get: vi.fn(async () => ({ exportedAt: '2026-11-04T10:00:00.000Z' })) },
}));

import { downloadExport } from './downloadExport';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('saves the file under its date, and frees the blob only after the browser has taken it', async () => {
  vi.useFakeTimers();
  const create = vi.fn(() => 'blob:export');
  const revoke = vi.fn();
  Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    expect(this.download).toBe('wally-export-2026-11-04.json');
    expect(this.href).toBe('blob:export');
  });

  await downloadExport();

  expect(click).toHaveBeenCalledTimes(1);
  expect(revoke).not.toHaveBeenCalled();
  vi.runAllTimers();
  expect(revoke).toHaveBeenCalledWith('blob:export');
});
