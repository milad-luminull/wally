import { defineConfig, devices } from '@playwright/test';

/**
 * Assumes apps/web is already served (dev server or preview) at BASE_URL, and the real
 * API is reachable at whatever VITE_API_BASE_URL points to — these specs are written
 * against the full stack (`make up`), not run standalone. See apps/web/e2e/README notes
 * in the specs themselves.
 */
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'html',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    // These specs assert German copy. The app falls back to navigator.language when nothing
    // is stored, and Playwright's device presets report en-US — without this pin every spec
    // would silently render in English and fail on the first getByLabel('E-Mail').
    locale: 'de-DE',
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-list-only',
      use: { ...devices['iPhone 13'] },
      testMatch: /mobile-list-only\.spec\.ts/,
    },
  ],
});
