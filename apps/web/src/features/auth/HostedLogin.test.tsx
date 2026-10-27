import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthContext, type AuthContextValue } from './authContext';
import { HostedLogin } from './HostedLogin';

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Return path">{location.state?.from}</output>;
}

describe('hosted sign-in', () => {
  it.each([false, true])(
    'keeps login/signup navigation and the board return path (signup=%s)',
    async (signup) => {
      render(
        <MemoryRouter
          initialEntries={[
            { pathname: signup ? '/signup' : '/login', state: { from: '/boards/known' } },
          ]}
        >
          <AuthContext.Provider
            value={{ hostedLogin: async () => {} } as unknown as AuthContextValue}
          >
            <HostedLogin signup={signup} />
            <LocationProbe />
          </AuthContext.Provider>
        </MemoryRouter>,
      );
      expect(screen.getByRole('link', { name: signup ? 'Sign in' : 'Sign up' })).toHaveAttribute(
        'href',
        signup ? '/login' : '/signup',
      );
      await userEvent.click(screen.getByRole('link', { name: signup ? 'Sign in' : 'Sign up' }));
      expect(screen.getByLabelText('Return path')).toHaveTextContent('/boards/known');
    },
  );
  it('offers hosted login and points to password reset without collecting a password', async () => {
    let target: unknown;
    render(
      <MemoryRouter initialEntries={[{ pathname: '/login', state: { from: '/boards/known' } }]}>
        <AuthContext.Provider
          value={
            {
              hostedLogin: async (signup, returnPath) => {
                target = { signup, returnPath };
              },
            } as AuthContextValue
          }
        >
          <HostedLogin />
        </AuthContext.Provider>
      </MemoryRouter>,
    );
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(screen.getByText(/forgot your password/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Continue to sign in' }));
    expect(target).toEqual({ signup: false, returnPath: '/boards/known' });
  });
  it('explains a sign-in not linked to a Wally account and lets the user switch accounts', async () => {
    let loggedOut = false;
    render(
      <MemoryRouter>
        <AuthContext.Provider
          value={
            {
              authError: 'migration',
              hostedLogin: async () => {},
              signOut: async () => {
                loggedOut = true;
              },
            } as unknown as AuthContextValue
          }
        >
          <HostedLogin />
        </AuthContext.Provider>
      </MemoryRouter>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/not linked to a Wally account/i);
    await userEvent.click(screen.getByRole('button', { name: 'Use another account' }));
    expect(loggedOut).toBe(true);
  });
});
