import {
  createContext,
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
import { auth } from './firebase';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

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

interface AuthContextValue {
  user: User | null;
  idToken: string | null;
  status: AuthStatus;
  /**
   * Reactive mirror of `user.emailVerified`. Firebase mutates the `User` object in place —
   * `reload()` returns the very same instance — so re-setting it is an Object.is bailout
   * and reading `user.emailVerified` in a component never re-renders. This primitive is the
   * only safe source of truth for verification state.
   */
  emailVerified: boolean;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
  /**
   * Re-reads the Firebase user, then force-refreshes the ID token so the API starts seeing
   * `email_verified: true`. Resolves to the freshly read verification state.
   */
  refreshUser: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [emailVerified, setEmailVerified] = useState(false);
  // Firebase can fire onAuthStateChanged before the token is attached; track it so we
  // never flip to "authenticated" without a usable token.
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        tokenRef.current = null;
        setUser(null);
        setIdToken(null);
        setEmailVerified(false);
        setStatus('unauthenticated');
        return;
      }
      try {
        const token = await firebaseUser.getIdToken();
        tokenRef.current = token;
        setUser(firebaseUser);
        setIdToken(token);
        setEmailVerified(firebaseUser.emailVerified);
        setStatus('authenticated');
      } catch {
        setUser(null);
        setIdToken(null);
        setEmailVerified(false);
        setStatus('unauthenticated');
      }
    });
    return unsubscribe;
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  }, []);

  const signUpWithEmail = useCallback(async (email: string, password: string) => {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    try {
      // The API refuses to activate a pending board invite until Firebase confirms the
      // address (see apps/api/src/plugins/auth.ts), and Firebase does not send this by
      // itself on sign-up — without it an invited colleague could never be let in.
      await sendEmailVerification(credential.user, verificationSettings());
    } catch {
      // A failed send must never fail the sign-up: the account exists either way, and the
      // banner in AppShell offers a manual resend. `auth/too-many-requests` is the common
      // case when signing up repeatedly from one address.
    }
  }, []);

  const resendVerificationEmail = useCallback(async () => {
    const current = auth.currentUser;
    if (!current) throw new Error('resendVerificationEmail requires a signed-in user');
    await sendEmailVerification(current, verificationSettings());
  }, []);

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
    setIdToken(token);
    setEmailVerified(current.emailVerified);
    return current.emailVerified;
  }, []);

  const signInWithGoogle = useCallback(async () => {
    await signInWithPopup(auth, new GoogleAuthProvider());
  }, []);

  const signOut = useCallback(async () => {
    await firebaseSignOut(auth);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      idToken,
      status,
      emailVerified,
      signInWithEmail,
      signUpWithEmail,
      signInWithGoogle,
      signOut,
      resendVerificationEmail,
      refreshUser,
    }),
    [
      user,
      idToken,
      status,
      emailVerified,
      signInWithEmail,
      signUpWithEmail,
      signInWithGoogle,
      signOut,
      resendVerificationEmail,
      refreshUser,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
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
  const current = auth.currentUser;
  if (!current) return null;
  return current.getIdToken(forceRefresh);
}
