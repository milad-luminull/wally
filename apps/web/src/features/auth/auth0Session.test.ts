import { describe, expect, it, vi } from 'vitest';
import {
  createAuth0Session,
  getAuth0AccessToken,
  registerAuth0TokenSource,
  type Auth0ClientPort,
} from './auth0Session';

function client(): Auth0ClientPort {
  return {
    checkSession: async () => {},
    isAuthenticated: async () => true,
    getUser: async () => ({ sub: 'auth0|external', email_verified: true }),
    getTokenSilently: async () => 'access-token',
    handleRedirectCallback: async () => ({ appState: { returnPath: '/boards/original' } }),
    loginWithRedirect: async () => {},
    logout: async () => {},
  };
}
const profile = {
  id: 'original-wally-id',
  email: 'person@example.com',
  displayName: 'Person',
  language: 'en',
  preferences: { theme: 'system', canvas: 'dots', lastBoardId: null, boards: {} },
};
describe('Auth0 session adapter', () => {
  it('ignores a terminal error from an obsolete token registration', async () => {
    let reject!: (error: unknown) => void;
    let expired = false;
    registerAuth0TokenSource(
      () =>
        new Promise<string>((_, fail) => {
          reject = fail;
        }),
      () => {
        expired = true;
      },
    );
    const pending = getAuth0AccessToken();
    const unregister = registerAuth0TokenSource(async () => 'new-account-token');
    reject({ error: 'invalid_grant' });
    expect(await pending).toBeNull();
    expect(expired).toBe(false);
    expect(await getAuth0AccessToken()).toBe('new-account-token');
    unregister();
  });

  it('discards an in-flight token after logout removes its source', async () => {
    let finish!: (token: string) => void;
    const unregister = registerAuth0TokenSource(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = getAuth0AccessToken();
    unregister();
    finish('old-account-token');
    expect(await pending).toBeNull();
  });

  it('uses the API identity rather than the provider subject for board ownership', async () => {
    const session = createAuth0Session(
      client(),
      'https://api.wally.luminull.com',
      async (url, init) => {
        expect(url).toBe('https://api.wally.luminull.com/me');
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-token');
        return new Response(JSON.stringify(profile));
      },
    );
    expect(await session.load()).toMatchObject({
      user: { uid: 'original-wally-id' },
      accessToken: 'access-token',
      emailVerified: true,
    });
  });
  it('keeps an unimported account signed out with a recoverable migration error', async () => {
    const session = createAuth0Session(
      client(),
      'https://api.wally.luminull.com',
      async () => new Response(JSON.stringify({ error: 'IDENTITY_NOT_LINKED' }), { status: 403 }),
    );
    await expect(session.load()).rejects.toMatchObject({ code: 'IDENTITY_NOT_LINKED' });
  });
  it('does not use an ID token or publish an account on profile failure', async () => {
    const session = createAuth0Session(
      client(),
      'https://api.wally.luminull.com',
      async () => new Response('offline', { status: 503 }),
    );
    await expect(session.load()).rejects.toMatchObject({ code: 'SESSION_UNAVAILABLE' });
  });
  it('handles a callback once and sanitizes an external return path', async () => {
    let exchanges = 0;
    const sdk = client();
    sdk.handleRedirectCallback = async () => {
      exchanges++;
      return { appState: { returnPath: '//attacker.example' } };
    };
    const session = createAuth0Session(sdk, 'https://api.wally.luminull.com');
    expect(await session.initialize('https://wally.luminull.com/login?code=a&state=b')).toEqual({
      callback: true,
      returnPath: null,
    });
    await session.initialize('https://wally.luminull.com/login?code=a&state=b');
    expect(exchanges).toBe(1);
  });
  it('asks the SDK for a fresh access token after a 401', async () => {
    const sdk = client();
    sdk.getTokenSilently = async (options) =>
      options?.cacheMode === 'off' ? 'refreshed-access-token' : 'cached-access-token';
    const session = createAuth0Session(sdk, 'https://api.wally.luminull.com');
    expect(await session.token(true)).toBe('refreshed-access-token');
    expect(await session.token(false)).toBe('cached-access-token');
  });
  it('does not fetch profile data when signed out', async () => {
    const sdk = client();
    sdk.isAuthenticated = async () => false;
    const fetcher = vi.fn(() => {
      throw new Error('must not fetch');
    });
    expect(
      await createAuth0Session(sdk, 'https://api.wally.luminull.com', fetcher).load(),
    ).toBeNull();
  });
});
