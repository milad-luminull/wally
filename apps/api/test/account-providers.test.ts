import { expect, it, vi } from 'vitest';
import { deletionProviders } from '../src/lib/account/providers.js';
const config = {
  issuer: 'https://login.example/',
  managementDomain: 'tenant.eu.auth0.com',
  clientId: 'cleanup',
  clientSecret: 'test-only-secret',
};
it('deletes only an exact verified subject, reuses the token and accepts not-found on retry', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'test-only-token', expires_in: 3600 })),
    )
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(new Response(null, { status: 404 }));
  const providers = deletionProviders(config, request);
  await providers.deleteAuth0(config.issuer, 'google-oauth2|123');
  await providers.deleteAuth0(config.issuer, 'google-oauth2|123');
  expect(request.mock.calls.map((call) => call[0])).toEqual([
    'https://tenant.eu.auth0.com/oauth/token',
    'https://tenant.eu.auth0.com/api/v2/users/google-oauth2%7C123',
    'https://tenant.eu.auth0.com/api/v2/users/google-oauth2%7C123',
  ]);
  await expect(
    providers.deleteAuth0('https://wrong.example/', 'google-oauth2|123'),
  ).rejects.toThrow('Unverified');
  expect(request).toHaveBeenCalledTimes(3);
});
it('keeps provider errors retryable rather than reporting deletion complete', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'test-only-token', expires_in: 3600 })),
    )
    .mockResolvedValueOnce(new Response(null, { status: 429 }));
  await expect(
    deletionProviders(config, request).deleteAuth0(config.issuer, 'auth0|exact'),
  ).rejects.toThrow('pending');
});
