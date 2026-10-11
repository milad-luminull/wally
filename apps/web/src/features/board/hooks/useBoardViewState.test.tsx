import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import { DEFAULT_PREFERENCES, type MeDto } from '@wally/shared';

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ status: 'authenticated' }),
}));
vi.mock('@/lib/resources', () => ({
  meApi: { get: vi.fn(), updatePreferences: vi.fn() },
}));
// Imported after the mocks so they resolve to the mocked modules.
import { meApi } from '@/lib/resources';
import { SAVE_DELAY_MS } from '@/lib/preferences';
import { createTestQueryClient } from '@/test/renderWithProviders';
import { queryKeys } from './queryKeys';
import { useBoardViewState } from './useBoardViewState';

const PROFILE: MeDto = {
  id: 'u1',
  email: 'max@example.com',
  displayName: 'Max',
  language: 'de',
  preferences: {
    ...DEFAULT_PREFERENCES,
    boards: {
      b1: { view: 'list', axis: 'priority', done: false, mine: true, priority: ['HOCH'] },
    },
  },
};

function setup(route: string, profile: MeDto = PROFILE) {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(queryKeys.profile(), profile);
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }
  const boardId = new URL(route, 'http://x').pathname.split('/')[2]!;
  const hook = renderHook(() => ({ view: useBoardViewState(boardId), location: useLocation() }), {
    wrapper: Wrapper,
  });
  return { queryClient, ...hook };
}

describe('useBoardViewState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(meApi.updatePreferences).mockImplementation((update) =>
      Promise.resolve({ ...PROFILE, preferences: { ...PROFILE.preferences, ...update } } as MeDto),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('opens a board the way the user left it, with no params in the URL', () => {
    const { result } = setup('/boards/b1');

    expect(result.current.view).toMatchObject({
      view: 'list',
      axis: 'priority',
      done: false,
      mine: true,
      priority: ['HOCH'],
    });
  });

  it('falls back to the built-in defaults on a board with nothing saved', () => {
    const { result } = setup('/boards/b2');

    expect(result.current.view).toMatchObject({
      view: 'wand',
      axis: 'horizon',
      done: true,
      mine: false,
      priority: [],
    });
    expect(result.current.view.isCustomized).toBe(false);
  });

  it('lets a shared link override the saved settings', () => {
    const { result } = setup('/boards/b1?view=wand&axis=free&done=1');

    expect(result.current.view).toMatchObject({ view: 'wand', axis: 'free', done: true });
    // Untouched by the link, so still the saved value.
    expect(result.current.view.mine).toBe(true);
  });

  it('saves a change to the profile and drops the remembered params from the URL', async () => {
    const { result, queryClient } = setup('/boards/b1?axis=free&q=report');

    act(() => result.current.view.setView('wand'));

    // Optimistic: the cached profile already carries the full effective state.
    expect(queryClient.getQueryData<MeDto>(queryKeys.profile())?.preferences.boards.b1).toEqual({
      view: 'wand',
      axis: 'free',
      done: false,
      mine: true,
      priority: ['HOCH'],
    });
    expect(result.current.location.search).toBe('?q=report');
    expect(result.current.view.axis).toBe('free');

    // One debounced write for a burst of changes.
    act(() => result.current.view.setDone(true));
    expect(meApi.updatePreferences).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    });
    expect(meApi.updatePreferences).toHaveBeenCalledTimes(1);
    expect(meApi.updatePreferences).toHaveBeenCalledWith({
      boards: { b1: { view: 'wand', axis: 'free', done: true, mine: true, priority: ['HOCH'] } },
    });
  });

  it('reset forgets the board and clears every filter', async () => {
    const { result } = setup('/boards/b1?q=report&field=Kunde');

    act(() => result.current.view.resetView());

    expect(result.current.view).toMatchObject({ view: 'wand', axis: 'horizon', q: '' });
    expect(result.current.view.fieldKey).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    });
    expect(meApi.updatePreferences).toHaveBeenCalledWith({ boards: { b1: null } });
  });

  it('clears the property value together with its key', () => {
    const { result } = setup('/boards/b1?field=Kunde&fieldValue=ACME');

    act(() => result.current.view.setFieldKey('Phase'));

    expect(result.current.view.fieldKey).toBe('Phase');
    expect(result.current.view.fieldValue).toBeNull();
  });
});
