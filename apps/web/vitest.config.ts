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
    env: {
      VITE_API_BASE_URL: 'http://localhost:4000',
    },
  },
});
