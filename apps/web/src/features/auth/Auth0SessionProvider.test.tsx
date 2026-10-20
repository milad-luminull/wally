import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { useContext, type ReactNode } from 'react';
import { AuthContext } from './authContext';
import { Auth0SessionProvider } from './Auth0SessionProvider';
import { createAuth0Session, getAuth0AccessToken, type Auth0ClientPort } from './auth0Session';

function setup(fetcher: typeof fetch) {
  const client: Auth0ClientPort = {
    checkSession: async () => {},
    isAuthenticated: async () => true,
    getUser: async () => ({ sub: 'auth0|one', email_verified: true }),
    getTokenSilently: async () => 'access-token',
    handleRedirectCallback: async () => ({}),
    loginWithRedirect: async () => {},
    logout: async () => {},
  };
  const session = createAuth0Session(client, 'http://localhost:4000', fetcher);
  const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    query,
    client,
    session,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={query}>
        <Auth0SessionProvider session={session}>{children}</Auth0SessionProvider>
      </QueryClientProvider>
    ),
  };
}
const profile = {
  id: 'wally-original',
  email: 'person@example.com',
  displayName: 'Person',
  language: 'en',
  preferences: { theme: 'system', canvas: 'dots', lastBoardId: null, boards: {} },
};
describe('Auth0 application session', () => {
  it.each(['login_required', 'invalid_grant', 'consent_required'])(
    'clears the local session after terminal SDK token error %s',
    async (error) => {
      const fixture = setup(async () => new Response(JSON.stringify(profile)));
      const { result } = renderHook(() => useContext(AuthContext)!, { wrapper: fixture.wrapper });
      await waitFor(() => expect(result.current.status).toBe('authenticated'));
      fixture.query.setQueryData(['private'], 'old-account');
      fixture.client.getTokenSilently = async () => {
        throw { error };
      };
      await act(async () => {
        await expect(getAuth0AccessToken(true)).rejects.toEqual({ error });
      });
      expect(result.current.status).toBe('unauthenticated');
      expect(result.current.user).toBeNull();
      expect(result.current.authError).toBe('unavailable');
      expect(result.current.expired).toEqual({ unsaved: 0 });
      expect(fixture.query.getQueryData(['private'])).toBeUndefined();
      expect(await getAuth0AccessToken()).toBeNull();
    },
  );
  it('retains the session and cache after a transient token network failure', async () => {
    const fixture = setup(async () => new Response(JSON.stringify(profile)));
    const { result } = renderHook(() => useContext(AuthContext)!, { wrapper: fixture.wrapper });
    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    fixture.query.setQueryData(['private'], 'current-account');
    fixture.client.getTokenSilently = async () => {
      throw new TypeError('Failed to fetch');
    };
    await act(async () => {
      await expect(getAuth0AccessToken(true)).rejects.toThrow('Failed to fetch');
    });
    expect(result.current.status).toBe('authenticated');
    expect(fixture.query.getQueryData(['private'])).toBe('current-account');
    fixture.client.getTokenSilently = async () => 'recovered-token';
    expect(await getAuth0AccessToken()).toBe('recovered-token');
  });
  it('expires the session when verification refresh encounters a terminal SDK error', async () => {
    const fixture = setup(async () => new Response(JSON.stringify(profile)));
    const { result } = renderHook(() => useContext(AuthContext)!, { wrapper: fixture.wrapper });
    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    fixture.client.getTokenSilently = async () => {
      throw { error: 'invalid_grant' };
    };
    await act(async () => {
      await result.current.refreshUser().catch(() => false);
    });
    expect(result.current.status).toBe('unauthenticated');
    expect(await getAuth0AccessToken()).toBeNull();
  });

  it('does not restart loading after initialization completes following cross-tab logout', async () => {
    const fixture = setup(async () => new Response(JSON.stringify(profile)));
    let finish!: () => void;
    fixture.client.checkSession = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      });
    const { result } = renderHook(() => useContext(AuthContext)!, { wrapper: fixture.wrapper });
    await waitFor(() => expect(finish).toBeDefined());
    act(() =>
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'wally.auth0.logout', newValue: 'logout' }),
      ),
    );
    await act(async () => finish());
    expect(result.current.status).toBe('unauthenticated');
    expect(await getAuth0AccessToken()).toBeNull();
  });
  it('drops the previous account cache when refresh resolves a different stable user', async () => {
    let current = profile;
    const fixture = setup(async () => new Response(JSON.stringify(current)));
    const { result } = renderHook(() => useContext(AuthContext)!, { wrapper: fixture.wrapper });
    await waitFor(() => expect(result.current.user?.uid).toBe(profile.id));
    fixture.query.setQueryData(['private'], 'old-account');
    current = { ...profile, id: 'other-wally-user' };
    await act(async () => result.current.refreshUser());
    expect(result.current.user?.uid).toBe('other-wally-user');
    expect(fixture.query.getQueryData(['private'])).toBeUndefined();
  });

  it('publishes the stable user only after profile resolution and clears cache/token on logout', async () => {
    const fixture = setup(async () => new Response(JSON.stringify(profile)));
    const { result } = renderHook(() => useContext(AuthContext)!, { wrapper: fixture.wrapper });
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.user?.uid).toBe('wally-original'));
    fixture.query.setQueryData(['private'], 'belongs-to-original');
    expect(await getAuth0AccessToken()).toBe('access-token');
    await act(async () => result.current.signOut());
    expect(result.current.expired).toBeNull();
    expect(result.current.status).toBe('unauthenticated');
    expect(fixture.query.getQueryData(['private'])).toBeUndefined();
    expect(await getAuth0AccessToken()).toBeNull();
  });
  it('does not restore a session from a late request after logout', async () => {
    let finish!: (response: Response) => void;
    const fixture = setup(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(() => useContext(AuthContext)!, { wrapper: fixture.wrapper });
    await waitFor(() => expect(finish).toBeDefined());
    await act(async () => result.current.signOut());
    await act(async () => finish(new Response(JSON.stringify(profile))));
    expect(result.current.user).toBeNull();
    expect(await getAuth0AccessToken()).toBeNull();
  });
});
