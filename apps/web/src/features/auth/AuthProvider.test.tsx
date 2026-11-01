import { expect, it, vi } from 'vitest';

const getAuth0AccessToken = vi.hoisted(() => vi.fn());
vi.mock('./auth0Session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./auth0Session')>()),
  getAuth0AccessToken,
}));

import { getFreshIdToken } from './AuthProvider';

it('gets the API token from the Auth0 session', async () => {
  getAuth0AccessToken.mockResolvedValue('auth0-access-token');

  expect(await getFreshIdToken(true)).toBe('auth0-access-token');
  expect(getAuth0AccessToken).toHaveBeenCalledWith(true);
});
