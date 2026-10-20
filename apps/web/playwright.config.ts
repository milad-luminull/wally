import { defineConfig, devices } from '@playwright/test';

/**
 * Assumes apps/web is already served (dev server or preview) at BASE_URL, and the real
 * API is reachable at whatever VITE_API_BASE_URL points to — these specs are written
 * against the full stack (`make up`), not run standalone. See apps/web/e2e/README notes
 * in the specs themselves.
 *
 * In CI the stack comes up via docker-compose.ci.yml, which publishes the web app on
 * 5174, so .github/workflows/ci.yml sets PLAYWRIGHT_BASE_URL explicitly.
 */
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,

  // Every spec signs in as the same E2E_USER_EMAIL, and a board's document id IS its
  // owner's uid (see seed.ts: `const BOARD_ID = OWNER_UID`) — so all the specs share one
  // board and would mutate it concurrently. They also share a single @fastify/rate-limit
  // bucket, which is keyed on the user id. Serialise in CI; keep the local run parallel.
  workers: isCI ? 1 : undefined,

  // A real Firebase Auth round trip plus a cold Firestore emulator does not reliably fit
  // in Playwright's 30s default. The Vitest suites already use 20s for the same reason.
  timeout: isCI ? 60_000 : 30_000,

  reporter: isCI
    ? [
        ['list'],
        ['html', { open: 'never' }],
        // Consumed by the "fail if the suite was vacuously green" step in ci.yml.
        ['json', { outputFile: 'playwright-results.json' }],
        ['github'],
      ]
    : 'html',

  use: {
    baseURL: BASE_URL,

    // NEVER enable traces, video or HAR for credentialed runs, locally or in CI.
    // This repository is PUBLIC, so Actions
    // artifacts are downloadable by anyone holding the run URL. A Playwright trace records
    // every action's input value verbatim — including e2e/support.ts's
    // `getByLabel('Passwort').fill(PASSWORD)` — along with full request bodies, so it would
    // publish the E2E account's password and its Firebase ID tokens. GitHub's log masking
    // does not apply to artifact contents. Screenshots are safe: the password field renders
    // masked.
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure',

    // These specs assert German copy. The app falls back to navigator.language when nothing
    // is stored, and Playwright's device presets report en-US — without this pin every spec
    // would silently render in English and fail on the first getByLabel('E-Mail').
    locale: 'de-DE',
    // Runners are UTC; the app renders relative dates. Pin to match the locale.
    timezoneId: 'Europe/Berlin',
  },

  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'] },
      // Without this, the default testMatch (**/*.spec.ts) also collects
      // mobile-list-only.spec.ts here, where its assertions (a "Wand" tab, no drag
      // affordance) are false by construction at 1280x720. That failure is invisible today
      // only because every spec self-skips without E2E credentials.
      testIgnore: /mobile-list-only\.spec\.ts/,
    },
    {
      // devices['iPhone 13'] carries defaultBrowserType: 'webkit' — this project does NOT
      // run Chromium, so CI must install webkit as well.
      name: 'mobile-list-only',
      use: { ...devices['iPhone 13'] },
      testMatch: /mobile-list-only\.spec\.ts/,
    },
  ],
});
