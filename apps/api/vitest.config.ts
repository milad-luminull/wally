import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 20000,
    // The integration suites (test/**) share ONE real Postgres database and fixed fixture
    // ids (see test/helpers.ts's createBoardFixture), with `afterEach` truncating between
    // tests *within* a file. Vitest's default parallel-file execution ran multiple test
    // files against that same database at once, so one file's reset/insert raced another
    // file's in-flight test (unique-constraint violations, "record not found"). Disabling
    // file parallelism serializes all test files — the unit suites (src/**) don't need
    // this, but the correctness fix matters more than that slice of speed here.
    fileParallelism: false,
  },
});
