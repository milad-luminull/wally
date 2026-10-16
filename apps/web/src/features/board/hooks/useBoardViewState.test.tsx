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
import { scopedQueryKeys } from './queryKeys';
import { useBoardViewState } from './useBoardViewState';

// Hooks rendered outside AuthProvider read and write the signed-out scope.
const queryKeys = scopedQueryKeys(null);

const PROFILE: MeDto = {
  id: 'u1',
  email: 'max@example.com',
  displayName: 'Max',
  language: 'de',
  preferences: {
    ...DEFAULT_PREFERENCES,
    boards: {
      b1: {
        view: 'list',
        axis: 'priority',
        done: false,
        mine: true,
        priority: ['HOCH'],
        visibility: 'all',
      },
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
      visibility: 'all',
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
      boards: {
        b1: {
          view: 'wand',
          axis: 'free',
          done: true,
          mine: true,
          priority: ['HOCH'],
          visibility: 'all',
        },
      },
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

  it('reset filters saves all four filter defaults in one payload and clears the property filter', async () => {
    // Every filter non-default: done, mine and priority from the saved profile, visibility
    // and the property filter from the URL.
    const { result, queryClient } = setup(
      '/boards/b1?visibility=private&field=Kunde&fieldValue=ACME&q=report',
    );
    expect(result.current.view).toMatchObject({
      done: false,
      mine: true,
      priority: ['HOCH'],
      visibility: 'private',
      fieldKey: 'Kunde',
    });

    act(() => result.current.view.resetFilters());

    const expected = {
      view: 'list',
      axis: 'priority',
      done: true,
      mine: false,
      priority: [],
      visibility: 'all',
    };
    expect(queryClient.getQueryData<MeDto>(queryKeys.profile())?.preferences.boards.b1).toEqual(
      expected,
    );
    expect(result.current.view).toMatchObject({
      done: true,
      mine: false,
      priority: [],
      visibility: 'all',
      fieldKey: null,
      fieldValue: null,
      q: 'report',
    });
    expect(result.current.location.search).toBe('?q=report');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    });
    expect(meApi.updatePreferences).toHaveBeenCalledTimes(1);
    expect(meApi.updatePreferences).toHaveBeenCalledWith({ boards: { b1: expected } });
  });

  it('clears the property value together with its key', () => {
    const { result } = setup('/boards/b1?field=Kunde&fieldValue=ACME');

    act(() => result.current.view.setFieldKey('Phase'));

    expect(result.current.view.fieldKey).toBe('Phase');
    expect(result.current.view.fieldValue).toBeNull();
  });

  it('reads a visibility filter from the URL without saving it', () => {
    const { result } = setup('/boards/b1?visibility=private');

    expect(result.current.view.visibility).toBe('private');
    expect(meApi.updatePreferences).not.toHaveBeenCalled();
  });

  it('ignores an unknown visibility param', () => {
    const { result } = setup('/boards/b1?visibility=bogus');

    expect(result.current.view.visibility).toBe('all');
  });

  it('saves the visibility filter and drops its URL param', async () => {
    const { result } = setup('/boards/b1?visibility=private&q=report');

    act(() => result.current.view.setVisibility('shared'));

    expect(result.current.location.search).toBe('?q=report');
    expect(result.current.view.visibility).toBe('shared');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    });
    expect(meApi.updatePreferences).toHaveBeenCalledWith({
      boards: {
        b1: {
          view: 'list',
          axis: 'priority',
          done: false,
          mine: true,
          priority: ['HOCH'],
          visibility: 'shared',
        },
      },
    });
  });

  it('keeps the visibility filter when another remembered setting changes', async () => {
    const { result } = setup('/boards/b1?visibility=private');

    act(() => result.current.view.setDone(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    });
    expect(meApi.updatePreferences).toHaveBeenCalledWith({
      boards: {
        b1: {
          view: 'list',
          axis: 'priority',
          done: true,
          mine: true,
          priority: ['HOCH'],
          visibility: 'private',
        },
      },
    });
  });

  it('counts a visibility filter as a customized view and reset clears it', () => {
    const { result } = setup('/boards/b1?visibility=private');
    expect(result.current.view.isCustomized).toBe(true);

    act(() => result.current.view.resetView());

    expect(result.current.view.visibility).toBe('all');
    expect(result.current.location.search).toBe('');
  });

  it('keeps the question panel and the note panel mutually exclusive in the URL', () => {
    const { result } = setup('/boards/b1?note=n1');

    act(() => result.current.view.openAsk(true));
    expect(result.current.location.search).toBe('?ask=1');
    expect(result.current.view.askOpen).toBe(true);
    expect(result.current.view.noteId).toBeNull();
    // Asking to open it again while it is open is no navigation, so Back is not doubled.
    const openedAt = result.current.location.key;
    act(() => result.current.view.openAsk(true));
    expect(result.current.location.key).toBe(openedAt);

    act(() => result.current.view.openNote('n2'));
    expect(result.current.location.search).toBe('?note=n2');
    expect(result.current.view.askOpen).toBe(false);

    const noteAt = result.current.location.key;
    act(() => result.current.view.openAsk(false));
    expect(result.current.location.search).toBe('?note=n2');
    expect(result.current.location.key).toBe(noteAt);
  });

  it('is not customized on a default visibility', () => {
    const { result } = setup('/boards/b2');
    expect(result.current.view.isCustomized).toBe(false);
  });
});
