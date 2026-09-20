import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 20000,
    // Files run in parallel again: the suites that touch the datastore each declare their
    // own emulator project id, and the emulator keeps projects separate — so one file's
    // reset can no longer wipe another file's fixtures mid-test. (Under Postgres they all
    // shared one database and had to be serialized.)
  },
});
