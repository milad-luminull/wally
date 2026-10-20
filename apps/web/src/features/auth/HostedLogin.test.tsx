import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthContext, type AuthContextValue } from './authContext';
import { HostedLogin } from './HostedLogin';

describe('hosted sign-in', () => {
  it('offers hosted login and explains required password reset without collecting a password', async () => {
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
    expect(screen.getByText(/reset your password/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Continue to sign in' }));
    expect(target).toEqual({ signup: false, returnPath: '/boards/known' });
  });
  it('explains migration failure and lets the user switch accounts', async () => {
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
    expect(screen.getByRole('alert')).toHaveTextContent(/account is not ready/i);
    await userEvent.click(screen.getByRole('button', { name: 'Use another account' }));
    expect(loggedOut).toBe(true);
  });
});
