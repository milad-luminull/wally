import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 20000,
    // Files run in parallel: the Firestore suites each declare their own emulator project
    // id, and the PostgreSQL suites each clone their own database from a template migrated
    // once per run (test/postgres.ts) — so no file can wipe another file's fixtures.
    globalSetup: ['test/postgres-global-setup.ts'],
  },
});
