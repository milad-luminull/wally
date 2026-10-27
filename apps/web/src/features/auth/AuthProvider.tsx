import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  type User,
} from 'firebase/auth';
import { useQueryClient } from '@tanstack/react-query';
import { QueryScopeContext } from '@/features/board/hooks/queryKeys';
import { discardPendingPreferences, flushPreferences } from '@/lib/preferencesQueue';
import { auth as firebaseAuth } from './firebase';
import { getRecoveries, resetMutationSession } from '@/lib/mutationQueue';
import { clearNoteDrafts } from '@/lib/noteDrafts';
import { resetToasts } from '@/lib/toast';

export type { AuthStatus } from './authContext';
import { AuthContext, type AuthContextValue, type AuthStatus } from './authContext';
import { Auth0SessionProvider } from './Auth0SessionProvider';
import { getAuth0AccessToken } from './auth0Session';

/**
 * Sends the verification link back to this app instead of leaving the user on Firebase's
 * own confirmation page with no way back. `handleCodeInApp: false` keeps Firebase handling
 * the code itself — we only want the continue URL.
 *
 * The origin must be listed under Authorization → Settings → Authorized domains in the
 * Firebase console. `localhost` and the project's own *.firebaseapp.com / *.web.app
 * domains are there by default, which covers local dev and this deployment; a custom
 * domain would have to be added.
 */
function verificationSettings() {
  return { url: `${window.location.origin}/`, handleCodeInApp: false };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  return import.meta.env.VITE_AUTH_PROVIDER === 'auth0' ? (
    <Auth0SessionProvider>{children}</Auth0SessionProvider>
  ) : (
    <FirebaseAuthProvider>{children}</FirebaseAuthProvider>
  );
}

function FirebaseAuthProvider({ children }: { children: ReactNode }) {
  const auth = firebaseAuth;
  if (!auth) throw new Error('Firebase authentication is not configured');
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [emailVerified, setEmailVerified] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [expired, setExpired] = useState<{ unsaved: number } | null>(null);
  const [verificationSendFailed, setVerificationSendFailed] = useState(false);
  /** The person asked to sign out: the sign-out that follows is theirs, not an ended session. */
  const signingOut = useRef(false);
  // Firebase can fire onAuthStateChanged before the token is attached; track it so we
  // never flip to "authenticated" without a usable token.
  const tokenRef = useRef<string | null>(null);
  // `undefined` until Firebase has reported anyone at all.
  const uidRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    /**
     * Everything cached belongs to the account that fetched it — `/me` is whoever is calling,
     * and nothing else is keyed by user either. So on any change of account, before anything
     * renders for the new one: drop a preferences write still waiting to go out (it would be
     * sent with the new user's token), stop in-flight requests, and empty the cache. Keys are
     * also scoped per user (queryKeys.ts), which covers callbacks still running from the old
     * session.
     */
    /** Returns the uid that was signed in before, when this report is a different account. */
    function onIdentityChange(nextUid: string | null): string | null | undefined {
      const previous = uidRef.current;
      if (previous === nextUid) return undefined;
      uidRef.current = nextUid;
      if (previous === undefined) return undefined;
      resetMutationSession();
      clearNoteDrafts();
      resetToasts();
      discardPendingPreferences(queryClient);
      void queryClient.cancelQueries();
      queryClient.clear();
      return previous;
    }

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      // Counted before the account change empties the queue.
      const unsaved = getRecoveries().length;
      const previousUid = onIdentityChange(firebaseUser?.uid ?? null);
      if (!firebaseUser) {
        // Signed out without asking: the session ended on its own, and the sign-in page says so.
        const ended = typeof previousUid === 'string' && !signingOut.current;
        signingOut.current = false;
        setExpired(ended ? { unsaved } : null);
        setSignedOut(typeof previousUid === 'string');
        tokenRef.current = null;
        setUser(null);
        setEmailVerified(false);
        setStatus('unauthenticated');
        return;
      }
      if (previousUid) {
        // Straight from one account to another (another tab signed in): leave the signed-in
        // UI until the new token is ready, so nothing mounted for the previous account keeps
        // running against the new one.
        tokenRef.current = null;
        setUser(null);
        setStatus('loading');
      }
      try {
        const token = await firebaseUser.getIdToken();
        if (uidRef.current !== firebaseUser.uid) return;
        tokenRef.current = token;
        setUser(firebaseUser);
        setEmailVerified(firebaseUser.emailVerified);
        setSignedOut(false);
        setExpired(null);
        setStatus('authenticated');
      } catch {
        if (uidRef.current !== firebaseUser.uid) return;
        onIdentityChange(null);
        setUser(null);
        setEmailVerified(false);
        setStatus('unauthenticated');
      }
    });
    return unsubscribe;
  }, [queryClient, auth]);

  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      await signInWithEmailAndPassword(auth, email, password);
    },
    [auth],
  );

  const signUpWithEmail = useCallback(
    async (email: string, password: string) => {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      try {
        // The API refuses to activate a pending board invite until Firebase confirms the
        // address (see apps/api/src/plugins/auth.ts), and Firebase does not send this by
        // itself on sign-up — without it an invited colleague could never be let in.
        await sendEmailVerification(credential.user, verificationSettings());
        setVerificationSendFailed(false);
      } catch {
        // A failed send must never fail the sign-up: the account exists either way. The banner
        // in AppShell says it did not go out and offers Resend. `auth/too-many-requests` is the
        // common case when signing up repeatedly from one address.
        setVerificationSendFailed(true);
      }
    },
    [auth],
  );

  const resendVerificationEmail = useCallback(async () => {
    const current = auth.currentUser;
    if (!current) throw new Error('resendVerificationEmail requires a signed-in user');
    await sendEmailVerification(current, verificationSettings());
    setVerificationSendFailed(false);
  }, [auth]);

  const refreshUser = useCallback(async () => {
    const current = auth.currentUser;
    if (!current) return false;
    // reload() updates the client-side flags; getIdToken(true) then mints a token carrying
    // the updated email_verified claim. The forced refresh also repopulates Firebase's own
    // token cache, so apiClient's plain getFreshIdToken(false) sends the new token on the
    // very next request — which is what activates the pending invite server-side.
    await current.reload();
    const token = await current.getIdToken(true);
    tokenRef.current = token;
    setEmailVerified(current.emailVerified);
    return current.emailVerified;
  }, [auth]);

  const signInWithGoogle = useCallback(async () => {
    await signInWithPopup(auth, new GoogleAuthProvider());
  }, [auth]);

  const signOut = useCallback(async () => {
    // A preference change still inside its debounce belongs to this account; send it while
    // its token is still the one attached. A failure has already been reported by the toast.
    await flushPreferences(queryClient).catch(() => {});
    signingOut.current = true;
    await firebaseSignOut(auth).catch((error: unknown) => {
      signingOut.current = false;
      throw error;
    });
  }, [queryClient, auth]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      emailVerified,
      signedOut,
      expired,
      verificationSendFailed,
      signInWithEmail,
      signUpWithEmail,
      signInWithGoogle,
      signOut,
      resendVerificationEmail,
      refreshUser,
    }),
    [
      user,
      status,
      emailVerified,
      signedOut,
      expired,
      verificationSendFailed,
      signInWithEmail,
      signUpWithEmail,
      signInWithGoogle,
      signOut,
      resendVerificationEmail,
      refreshUser,
    ],
  );

  return (
    <AuthContext.Provider value={value}>
      <QueryScopeContext.Provider value={user?.uid ?? null}>{children}</QueryScopeContext.Provider>
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

/**
 * Fetches a fresh ID token on demand (forcing a refresh), for the API client to call
 * before a request or on a 401 retry. Not part of the context value itself — the API
 * client lives outside React and must not depend on component state.
 */
export async function getFreshIdToken(forceRefresh = false): Promise<string | null> {
  if (import.meta.env.VITE_AUTH_PROVIDER === 'auth0') return getAuth0AccessToken(forceRefresh);
  const current = firebaseAuth?.currentUser;
  if (!current) return null;
  return current.getIdToken(forceRefresh);
}
