import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { QueryScopeContext } from '@/features/board/hooks/queryKeys';
import { clearNoteDrafts } from '@/lib/noteDrafts';
import { getRecoveries, resetMutationSession } from '@/lib/mutationQueue';
import { resetToasts } from '@/lib/toast';
import { discardPendingPreferences, flushPreferences } from '@/lib/preferencesQueue';
import { AuthContext, type AuthContextValue } from './authContext';
import {
  getAuth0Session,
  registerAuth0TokenSource,
  isTerminalAuth0Error,
  type Auth0Session,
} from './auth0Session';
import { readReturnPath } from './returnPath';

type Loaded = Awaited<ReturnType<Auth0Session['load']>>;
/** Publishes a session only after the API has resolved the stable Wally identity. */
export function Auth0SessionProvider({
  children,
  session = getAuth0Session(),
}: {
  children: ReactNode;
  session?: Auth0Session;
}) {
  const queryClient = useQueryClient();
  const [loaded, setLoaded] = useState<Loaded>(null);
  const [status, setStatus] = useState<AuthContextValue['status']>('loading');
  const [authError, setAuthError] = useState<AuthContextValue['authError']>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [expired, setExpired] = useState<{ unsaved: number } | null>(null);
  const generation = useRef(0);
  const userId = useRef<string | null>(null);
  const loggingOut = useRef(false);
  const clearSource = useRef<(() => void) | undefined>(undefined);
  const invalidate = useCallback(() => {
    generation.current++;
    clearSource.current?.();
  }, []);
  const clear = useCallback(() => {
    invalidate();
    resetMutationSession();
    clearNoteDrafts();
    resetToasts();
    discardPendingPreferences(queryClient);
    void queryClient.cancelQueries();
    queryClient.clear();
    userId.current = null;
    setLoaded(null);
  }, [queryClient, invalidate]);
  const expireSession = useCallback(() => {
    const unsaved = getRecoveries().length;
    loggingOut.current = true;
    clear();
    setExpired({ unsaved });
    setStatus('unauthenticated');
    setSignedOut(true);
    setAuthError('unavailable');
  }, [clear]);
  const load = useCallback(
    async (force = false) => {
      if (loggingOut.current) return false;
      const current = ++generation.current;
      let next: Loaded;
      try {
        next = await session.load(force);
      } catch (error) {
        if (current !== generation.current || loggingOut.current) return false;
        if (isTerminalAuth0Error(error)) {
          expireSession();
          return false;
        }
        throw error;
      }
      if (current !== generation.current || loggingOut.current) return false;
      if (userId.current !== null && userId.current !== (next?.user.uid ?? null)) clear();
      userId.current = next?.user.uid ?? null;
      clearSource.current?.();
      if (next) clearSource.current = registerAuth0TokenSource(session.token, expireSession);
      setLoaded(next);
      setStatus(next ? 'authenticated' : 'unauthenticated');
      setAuthError(null);
      if (next) {
        setSignedOut(false);
        setExpired(null);
      }
      return next?.emailVerified ?? false;
    },
    [session, clear, expireSession],
  );
  useEffect(() => {
    let active = true;
    const initializedGeneration = generation.current;
    void (async () => {
      try {
        const result = await session.initialize(window.location.href);
        if (!active || initializedGeneration !== generation.current || loggingOut.current) return;
        if (result.callback) {
          window.history.replaceState({ usr: { from: result.returnPath } }, '', '/login');
          window.dispatchEvent(new PopStateEvent('popstate'));
        }
        await load();
      } catch (error) {
        if (!active || loggingOut.current) return;
        window.history.replaceState(window.history.state, '', window.location.pathname);
        clear();
        setStatus('unauthenticated');
        setAuthError(
          (error as { code?: string }).code === 'IDENTITY_NOT_LINKED' ? 'migration' : 'unavailable',
        );
      }
    })();
    const onLogout = (event: StorageEvent) => {
      if (event.key !== 'wally.auth0.logout' || !event.newValue) return;
      loggingOut.current = true;
      clear();
      setStatus('unauthenticated');
      setSignedOut(true);
      setExpired(null);
    };
    window.addEventListener('storage', onLogout);
    return () => {
      active = false;
      invalidate();
      window.removeEventListener('storage', onLogout);
    };
  }, [clear, invalidate, load, session]);
  const hostedLogin = async (signup: boolean, returnPath: string | null) => {
    await session.client.loginWithRedirect({
      appState: { returnPath: readReturnPath({ from: returnPath }) },
      authorizationParams: {
        ...(signup ? { screen_hint: 'signup' as const } : {}),
        ...(authError ? { prompt: 'login' as const } : {}),
      },
    });
  };
  const signOut = async () => {
    loggingOut.current = true;
    generation.current++;
    await flushPreferences(queryClient).catch(() => {});
    clear();
    setSignedOut(true);
    setExpired(null);
    setStatus('unauthenticated');
    try {
      localStorage.setItem('wally.auth0.logout', String(Date.now()));
    } catch {
      /* Memory-only browsing still supports local logout. */
    }
    await session.client.logout({ logoutParams: { returnTo: `${window.location.origin}/login` } });
  };
  return (
    <AuthContext.Provider
      value={{
        user: loaded?.user ?? null,
        idToken: loaded?.accessToken ?? null,
        emailVerified: loaded?.emailVerified ?? false,
        status,
        signedOut,
        expired,
        verificationSendFailed: false,
        authError,
        hostedLogin,
        signOut,
        signInWithEmail: () => hostedLogin(false, null),
        signUpWithEmail: () => hostedLogin(true, null),
        signInWithGoogle: () =>
          session.client.loginWithRedirect({
            appState: { returnPath: null },
            authorizationParams: { connection: 'google-oauth2' },
          }),
        // Hosted login owns verification/recovery; legacy password forms are hidden in Auth0 mode.
        resendVerificationEmail: () => hostedLogin(false, null),
        refreshUser: () => load(true),
      }}
    >
      <QueryScopeContext.Provider
        key={loaded?.user.uid ?? 'signed-out'}
        value={loaded?.user.uid ?? null}
      >
        {children}
      </QueryScopeContext.Provider>
    </AuthContext.Provider>
  );
}
