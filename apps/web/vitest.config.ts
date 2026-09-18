import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    exclude: ['**/node_modules/**', '**/e2e/**', '**/dist/**'],
    // Vitest's 5000ms default is too tight for a Radix-heavy tree (Popover + Tabs +
    // Select + Command all mounting together, e.g. ShareSheet) under jsdom, where
    // floating-ui positioning and multiple portal mounts add real wall-clock time.
    // Matches apps/api's vitest testTimeout for consistency.
    testTimeout: 20000,
    // src/features/auth/firebase.ts calls initializeApp()/getAuth() at MODULE LOAD time,
    // so any test that transitively imports it (e.g. ProtectedRoute -> AuthProvider ->
    // firebase.ts) needs *some* config present just to import successfully, even with
    // Firebase itself mocked out in the test. No real project — these never make a
    // network call unless a test actually exercises sign-in.
    env: {
      VITE_FIREBASE_API_KEY: 'test-api-key',
      VITE_FIREBASE_AUTH_DOMAIN: 'test.firebaseapp.com',
      VITE_FIREBASE_PROJECT_ID: 'test-project',
      VITE_FIREBASE_APP_ID: '1:000000000000:web:0000000000000000000000',
      VITE_API_BASE_URL: 'http://localhost:4000',
    },
  },
});
