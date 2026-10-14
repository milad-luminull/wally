import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The live Firebase user the SDK would hand us; `reload()` mutates it in place. */
interface FakeUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  getIdToken: ReturnType<typeof vi.fn>;
  reload: ReturnType<typeof vi.fn>;
}

// vi.mock factories are hoisted above every const in the file, so the shared stubs have to
// be hoisted with them.
const { authStub, listener } = vi.hoisted(() => ({
  authStub: { currentUser: null } as { currentUser: unknown },
  listener: { current: null } as { current: ((user: unknown) => void) | null },
}));

vi.mock('./firebase', () => ({ auth: authStub }));

vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class {},
  onAuthStateChanged: (_auth: unknown, cb: (user: unknown) => void) => {
    listener.current = cb;
    return () => {
      listener.current = null;
    };
  },
  signInWithEmailAndPassword: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  sendEmailVerification: vi.fn(),
}));

vi.mock('@/lib/resources', () => ({
  meApi: { get: vi.fn(), updatePreferences: vi.fn() },
}));

// Imported after the mocks so they resolve to the mocked module.
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import type { MeDto } from '@wally/shared';
import { meApi } from '@/lib/resources';
import { flushPreferences, queuePreferences } from '@/lib/preferencesQueue';
import { useMe } from '@/i18n/useProfileLanguage';
import { createTestQueryClient } from '@/test/renderWithProviders';
import { scopedQueryKeys } from '@/features/board/hooks/queryKeys';
import { AuthProvider, useAuth } from './AuthProvider';

function makeUser(overrides: Partial<FakeUser> = {}): FakeUser {
  return {
    uid: 'u-1',
    email: 'max@example.com',
    emailVerified: false,
    getIdToken: vi.fn(() => Promise.resolve('token-1')),
    reload: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}

function profileOf(uid: string): MeDto {
  return { id: uid, email: `${uid}@example.com` } as MeDto;
}

/** Signs the given user in through the captured onAuthStateChanged callback. */
async function signIn(user: FakeUser | null) {
  authStub.currentUser = user;
  await act(async () => {
    listener.current?.(user);
  });
}

describe('AuthProvider', () => {
  beforeEach(() => {
    authStub.currentUser = null;
    listener.current = null;
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  it('sends a verification email when a new account is created with a password', async () => {
    const user = makeUser();
    vi.mocked(createUserWithEmailAndPassword).mockResolvedValue({ user } as never);
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.signUpWithEmail('max@example.com', 'geheim123');
    });

    // Firebase does not send this itself, and the API refuses to activate a pending board
    // invite until the address is confirmed.
    expect(sendEmailVerification).toHaveBeenCalledWith(
      user,
      // Without a continue URL the link lands on Firebase's own page with no route back
      // into Wally, so the user has to find the tab again themselves.
      expect.objectContaining({ url: expect.stringContaining('http') }),
    );
  });

  it('still completes the sign-up when the verification email cannot be sent', async () => {
    vi.mocked(createUserWithEmailAndPassword).mockResolvedValue({ user: makeUser() } as never);
    vi.mocked(sendEmailVerification).mockRejectedValue({ code: 'auth/too-many-requests' });
    const { result } = renderHook(() => useAuth(), { wrapper });

    // The account exists either way; failing the sign-up over the mail would strand them
    // with credentials they were never told worked.
    await expect(
      result.current.signUpWithEmail('max@example.com', 'geheim123'),
    ).resolves.toBeUndefined();
  });

  /**
   * AuthProvider snapshotted the Firebase `User` into state once in onAuthStateChanged and
   * never re-read it. Firebase mutates that instance in place — reload() returns the same
   * object — so `user.emailVerified` stayed false in React until a full page reload, and the
   * banner went on telling a user who had just confirmed their address that they had not.
   */
  it('reports the refreshed verification state without a full page reload', async () => {
    const user = makeUser();
    const { result } = renderHook(() => useAuth(), { wrapper });
    await signIn(user);
    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    expect(result.current.emailVerified).toBe(false);

    // What clicking the link in the email does, from the client's point of view.
    user.reload.mockImplementation(async () => {
      user.emailVerified = true;
    });

    await act(async () => {
      await expect(result.current.refreshUser()).resolves.toBe(true);
    });

    expect(result.current.emailVerified).toBe(true);
    // Forced, so the new token carries email_verified — the API reads the claim, not the
    // client-side flag.
    expect(user.getIdToken).toHaveBeenCalledWith(true);
  });

  it('forces the token refresh only after reloading the user', async () => {
    const order: string[] = [];
    const user = makeUser({
      reload: vi.fn(async () => {
        order.push('reload');
      }),
      getIdToken: vi.fn(async () => {
        order.push('getIdToken');
        return 'token-2';
      }),
    });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await signIn(user);
    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    order.length = 0;

    await act(async () => {
      await result.current.refreshUser();
    });

    // Reversing these mints a token from flags that have not been re-read yet, leaving the
    // claim stale for another hour.
    expect(order).toEqual(['reload', 'getIdToken']);
  });

  it('is not "signed out" when the page opens with nobody signed in', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await signIn(null);
    expect(result.current.status).toBe('unauthenticated');
    expect(result.current.signedOut).toBe(false);
  });

  it('marks a sign-out of a signed-in account, and clears it when someone signs in', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await signIn(makeUser({ uid: 'u-1' }));
    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    expect(result.current.signedOut).toBe(false);

    await signIn(null);
    expect(result.current.status).toBe('unauthenticated');
    expect(result.current.signedOut).toBe(true);

    await signIn(makeUser({ uid: 'u-2' }));
    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    expect(result.current.signedOut).toBe(false);
  });

  it('clears the verification flag on sign-out', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await signIn(makeUser({ emailVerified: true }));
    await waitFor(() => expect(result.current.emailVerified).toBe(true));

    await signIn(null);

    // A stale `true` here would hide the banner from the next person to sign in.
    expect(result.current.emailVerified).toBe(false);
    expect(result.current.status).toBe('unauthenticated');
  });

  describe('changing account', () => {
    const alice = () => makeUser({ uid: 'alice', email: 'alice@example.com' });
    const bob = () => makeUser({ uid: 'bob', email: 'bob@example.com' });

    function renderMe() {
      return renderHook(() => ({ auth: useAuth(), me: useMe() }), { wrapper });
    }

    it.each([
      ['after a sign-out', true],
      ['straight from one account to the next', false],
    ])('never serves the previous account its profile (%s)', async (_label, signOutFirst) => {
      vi.mocked(meApi.get).mockResolvedValueOnce(profileOf('alice'));
      const { result } = renderMe();
      await signIn(alice());
      await waitFor(() => expect(result.current.me.data?.id).toBe('alice'));

      if (signOutFirst) await signIn(null);
      let answerBob: (me: MeDto) => void = () => {};
      vi.mocked(meApi.get).mockReturnValueOnce(new Promise((resolve) => (answerBob = resolve)));
      await signIn(bob());
      await waitFor(() => expect(result.current.auth.status).toBe('authenticated'));

      // Bob's own request is still out; nothing of Alice's may stand in for it.
      expect(result.current.me.data).toBeUndefined();
      expect(queryClient.getQueryData(scopedQueryKeys('alice').profile())).toBeUndefined();

      answerBob(profileOf('bob'));
      await waitFor(() => expect(result.current.me.data?.id).toBe('bob'));
    });

    it('drops a preferences change still waiting to go out', async () => {
      renderHook(() => useAuth(), { wrapper });
      await signIn(alice());
      queuePreferences(queryClient, scopedQueryKeys('alice'), { theme: 'dark' });

      await signIn(bob());
      await flushPreferences(queryClient);

      // Sent now it would carry Bob's token and land on Bob's profile.
      expect(meApi.updatePreferences).not.toHaveBeenCalled();
    });

    it('sends a held preferences change before signing out', async () => {
      const order: string[] = [];
      vi.mocked(meApi.updatePreferences).mockImplementation(async () => {
        order.push('save');
        return profileOf('alice');
      });
      vi.mocked(firebaseSignOut).mockImplementation(async () => {
        order.push('signOut');
      });
      const { result } = renderHook(() => useAuth(), { wrapper });
      await signIn(alice());
      queuePreferences(queryClient, scopedQueryKeys('alice'), { theme: 'dark' });

      await act(async () => {
        await result.current.signOut();
      });

      // Under Alice's token, while it is still the one attached.
      expect(order).toEqual(['save', 'signOut']);
    });
  });
});
