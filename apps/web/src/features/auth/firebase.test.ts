import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});
it('does not initialize Firebase when hosted authentication is selected without Firebase config', async () => {
  vi.resetModules();
  vi.stubEnv('VITE_AUTH_PROVIDER', 'auth0');
  vi.stubEnv('VITE_FIREBASE_API_KEY', '');
  vi.stubEnv('VITE_FIREBASE_PROJECT_ID', '');
  const firebase = await import('./firebase');
  expect(firebase.firebaseApp).toBeNull();
  expect(firebase.auth).toBeNull();
});
